using System.Net.WebSockets;
using System.Text;
using Nolane.DesktopHost;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
var inbound = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
await using var server = new LocalBridgeServer();
server.MessageReceived += json => inbound.TrySetResult(json);
server.Start();

var endpoint = new Uri($"ws://127.0.0.1:{LocalBridgeServer.Port}/bridge");
using (var rejected = new ClientWebSocket())
{
    rejected.Options.AddSubProtocol("nolane.infinite.v2");
    rejected.Options.SetRequestHeader("Origin", "https://attacker.example");
    var blocked = false;
    try
    {
        await rejected.ConnectAsync(endpoint, timeout.Token);
    }
    catch (WebSocketException)
    {
        blocked = true;
    }
    Check(blocked && rejected.State != WebSocketState.Open,
        "The loopback bridge accepted a WebSocket from an untrusted website Origin.");
}

using (var wrongPath = new ClientWebSocket())
{
    wrongPath.Options.AddSubProtocol("nolane.infinite.v2");
    wrongPath.Options.SetRequestHeader("Origin", LocalBridgeServer.AllowedOrigin);
    var blocked = false;
    try
    {
        await wrongPath.ConnectAsync(new Uri($"ws://127.0.0.1:{LocalBridgeServer.Port}/bridge/extra"), timeout.Token);
    }
    catch (WebSocketException)
    {
        blocked = true;
    }
    Check(blocked && wrongPath.State != WebSocketState.Open,
        "The loopback bridge accepted a non-canonical WebSocket path.");
}

using (var stalled = new System.Net.Sockets.TcpClient())
{
    await stalled.ConnectAsync(System.Net.IPAddress.Loopback, LocalBridgeServer.Port, timeout.Token);
    var stream = stalled.GetStream();
    var partialHeaders = Encoding.ASCII.GetBytes($"GET /bridge HTTP/1.1\r\nHost: 127.0.0.1:{LocalBridgeServer.Port}\r\n");
    await stream.WriteAsync(partialHeaders.AsMemory(), timeout.Token);
    using var readTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
    var eof = await stream.ReadAsync(new byte[1].AsMemory(), readTimeout.Token);
    Check(eof == 0, "The loopback bridge kept an incomplete handshake open past its five-second deadline.");
}

using var client = new ClientWebSocket();
client.Options.AddSubProtocol("nolane.infinite.v2");
client.Options.SetRequestHeader("Origin", LocalBridgeServer.AllowedOrigin);
await client.ConnectAsync(endpoint, timeout.Token);
Check(client.SubProtocol == "nolane.infinite.v2", "The bridge did not negotiate its required subprotocol.");

const string hello = "{\"type\":\"nolane.bridge.hello\",\"protocol\":2}";
await client.SendAsync(Encoding.UTF8.GetBytes(hello).AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
var received = await inbound.Task.WaitAsync(TimeSpan.FromSeconds(5), timeout.Token);
Check(received == hello, "The bridge did not deliver the workspace message unchanged.");

const string ready = "{\"type\":\"nolane.native.ready\",\"protocol\":2}";
await server.SendAsync(ready);
var buffer = new byte[2048];
var response = await client.ReceiveAsync(buffer.AsMemory(), timeout.Token);
Check(response.MessageType == WebSocketMessageType.Text, "The website did not receive a text response from the native host.");
Check(Encoding.UTF8.GetString(buffer, 0, response.Count) == ready, "The native-to-website message was changed.");

var oversizedMessage = new byte[2 * 1024 * 1024 + 1];
await client.SendAsync(oversizedMessage.AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
var closed = await client.ReceiveAsync(buffer.AsMemory(), timeout.Token);
Check(closed.MessageType == WebSocketMessageType.Close &&
      client.CloseStatus == WebSocketCloseStatus.MessageTooBig,
    "The bridge did not close a message that exceeded its 2 MiB safety limit.");

Console.WriteLine("PASS: loopback binding, Origin rejection, WebSocket negotiation, bidirectional messages and 2 MiB limit.");
