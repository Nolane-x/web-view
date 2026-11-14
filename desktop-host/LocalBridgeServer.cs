using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Nolane.DesktopHost;

internal sealed class LocalBridgeServer : IAsyncDisposable
{
    public const int Port = 43172;
    public const string AllowedOrigin = "https://nolane-x.github.io";
    private const int MaxMessageBytes = 2 * 1024 * 1024;
    private const string RequiredProtocol = "nolane.infinite.v2";
    private static readonly byte[] WebSocketGuid = Encoding.ASCII.GetBytes("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");

    private readonly TcpListener _listener = new(IPAddress.Loopback, Port);
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private WebSocket? _client;
    private Task? _acceptTask;
    private int _started;

    public event Action? ClientConnected;
    public event Action? ClientDisconnected;
    public event Action<string>? MessageReceived;

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) != 0) return;
        _listener.Start(8);
        _acceptTask = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(_stop.Token).ConfigureAwait(false); }
            catch { if (_stop.IsCancellationRequested) break; else continue; }
            client.NoDelay = true;
            _ = HandleClientAsync(client, _stop.Token);
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        WebSocket? socket = null;
        try
        {
            var stream = client.GetStream();
            var headers = await ReadHandshakeAsync(stream, cancellationToken).ConfigureAwait(false);
            if (!ValidateHandshake(headers, out var key))
            {
                await WriteHttpErrorAsync(stream, 403, "Forbidden", cancellationToken).ConfigureAwait(false);
                return;
            }

            var acceptInput = Encoding.ASCII.GetBytes(key + Encoding.ASCII.GetString(WebSocketGuid));
            var accept = Convert.ToBase64String(SHA1.HashData(acceptInput));
            var response = "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + accept + "\r\n" +
                "Sec-WebSocket-Protocol: " + RequiredProtocol + "\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(response), cancellationToken).ConfigureAwait(false);
            socket = WebSocket.CreateFromStream(stream, true, RequiredProtocol, TimeSpan.FromSeconds(30));

            var previous = Interlocked.Exchange(ref _client, socket);
            if (previous is not null)
            {
                try { await previous.CloseAsync(WebSocketCloseStatus.PolicyViolation, "A newer workspace connected.", CancellationToken.None).ConfigureAwait(false); }
                catch { try { previous.Abort(); } catch { } }
            }
            ClientConnected?.Invoke();
            await ReceiveLoopAsync(socket, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch { }
        finally
        {
            if (socket is not null)
            {
                if (ReferenceEquals(Interlocked.CompareExchange(ref _client, null, socket), socket))
                    ClientDisconnected?.Invoke();
                try { socket.Dispose(); } catch { }
            }
            client.Dispose();
        }
    }

    private static async Task<string> ReadHandshakeAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        using var memory = new MemoryStream();
        var one = new byte[1];
        while (memory.Length < 8192)
        {
            var count = await stream.ReadAsync(one.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (count == 0) throw new IOException("Client closed before WebSocket handshake.");
            memory.WriteByte(one[0]);
            var length = memory.Length;
            if (length >= 4)
            {
                var b = memory.GetBuffer();
                if (b[length - 4] == '\r' && b[length - 3] == '\n' && b[length - 2] == '\r' && b[length - 1] == '\n')
                    return Encoding.ASCII.GetString(b, 0, (int)length);
            }
        }
        throw new InvalidDataException("WebSocket handshake headers are too large.");
    }

    private static bool ValidateHandshake(string rawHeaders, out string key)
    {
        key = "";
        var lines = rawHeaders.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length < 2 || !lines[0].StartsWith("GET /bridge HTTP/1.1", StringComparison.Ordinal)) return false;
        var headers = lines.Skip(1)
            .Select(line => line.IndexOf(':') is var index && index > 0
                ? new KeyValuePair<string, string>(line[..index].Trim(), line[(index + 1)..].Trim())
                : default)
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Key))
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);

        if (!headers.TryGetValue("Origin", out var origin) || !string.Equals(origin, AllowedOrigin, StringComparison.Ordinal)) return false;
        if (!headers.TryGetValue("Host", out var host) || !string.Equals(host, "127.0.0.1:" + Port, StringComparison.Ordinal)) return false;
        if (!headers.TryGetValue("Upgrade", out var upgrade) || !string.Equals(upgrade, "websocket", StringComparison.OrdinalIgnoreCase)) return false;
        if (!headers.TryGetValue("Connection", out var connection) ||
            !connection.Split(',').Any(token => token.Trim().Equals("upgrade", StringComparison.OrdinalIgnoreCase))) return false;
        if (!headers.TryGetValue("Sec-WebSocket-Version", out var version) || version != "13") return false;
        if (!headers.TryGetValue("Sec-WebSocket-Key", out key)) return false;
        if (!headers.TryGetValue("Sec-WebSocket-Protocol", out var protocols) ||
            !protocols.Split(',').Any(token => token.Trim() == RequiredProtocol)) return false;
        try { return Convert.FromBase64String(key).Length == 16; }
        catch { return false; }
    }

    private static async Task WriteHttpErrorAsync(NetworkStream stream, int code, string reason, CancellationToken cancellationToken)
    {
        var body = Encoding.UTF8.GetBytes("Nolane local bridge rejected this request.");
        var header = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {code} {reason}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {body.Length}\r\n\r\n");
        try
        {
            await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
            await stream.WriteAsync(body, cancellationToken).ConfigureAwait(false);
        }
        catch { }
    }

    private async Task ReceiveLoopAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[32768];
        using var message = new MemoryStream();
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            try
            {
                var result = await socket.ReceiveAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Workspace disconnected.", CancellationToken.None).ConfigureAwait(false); } catch { }
                    return;
                }
                if (result.MessageType != WebSocketMessageType.Text)
                {
                    try { await socket.CloseAsync(WebSocketCloseStatus.InvalidMessageType, "Text messages only.", CancellationToken.None).ConfigureAwait(false); } catch { }
                    return;
                }
                if (message.Length + result.Count > MaxMessageBytes)
                {
                    try { await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Message exceeds the 2 MiB limit.", CancellationToken.None).ConfigureAwait(false); } catch { }
                    return;
                }
                message.Write(buffer, 0, result.Count);
                if (result.EndOfMessage)
                {
                    MessageReceived?.Invoke(Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length));
                    message.SetLength(0);
                }
            }
            catch (OperationCanceledException) { return; }
            catch { return; }
        }
    }

    public async Task SendAsync(string json)
    {
        var socket = Volatile.Read(ref _client);
        if (socket is null || socket.State != WebSocketState.Open) return;
        await _sendGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (socket.State == WebSocketState.Open)
                await socket.SendAsync(Encoding.UTF8.GetBytes(json).AsMemory(), WebSocketMessageType.Text, true, _stop.Token).ConfigureAwait(false);
        }
        catch { }
        finally { _sendGate.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();
        try { _listener.Stop(); } catch { }
        var socket = Interlocked.Exchange(ref _client, null);
        if (socket is not null)
        {
            try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Background bridge stopping.", CancellationToken.None).ConfigureAwait(false); }
            catch { try { socket.Abort(); } catch { } }
            socket.Dispose();
        }
        if (_acceptTask is not null) { try { await _acceptTask.ConfigureAwait(false); } catch { } }
        _sendGate.Dispose();
        _stop.Dispose();
    }
}
