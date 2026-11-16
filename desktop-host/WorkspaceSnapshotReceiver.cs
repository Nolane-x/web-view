using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Nolane.DesktopHost;

internal sealed record WorkspaceSnapshotCommit(
    long Revision,
    HashSet<string> WorkspaceIds,
    Dictionary<string, int> ProfileUsage);

internal sealed class WorkspaceSnapshotReceiver
{
    internal const int MaxWorkspaceIdCount = 24000;
    internal const int MaxProfileCount = 24000;
    internal const int ChunkSize = 256;

    private PendingSnapshot? _pending;
    private long _lastCommittedRevision;

    internal void Reset()
    {
        _pending = null;
        _lastCommittedRevision = 0;
    }

    internal bool TryBegin(JsonElement root)
    {
        if (!TryGetInt64(root, "revision", out var revision) || revision < 1 ||
            revision <= _lastCommittedRevision ||
            !TryGetInt32(root, "workspaceIdCount", out var workspaceIdCount) ||
            workspaceIdCount < 0 || workspaceIdCount > MaxWorkspaceIdCount ||
            !TryGetInt32(root, "profileCount", out var profileCount) ||
            profileCount < 0 || profileCount > MaxProfileCount ||
            !TryGetInt32(root, "chunkCount", out var chunkCount)) return false;

        if (_pending is not null && revision <= _pending.Revision) return false;

        var expectedChunks = Math.Max(CountChunks(workspaceIdCount), CountChunks(profileCount));
        if (chunkCount != expectedChunks || chunkCount > 94)
        {
            _pending = null;
            return false;
        }

        _pending = new PendingSnapshot(revision, workspaceIdCount, profileCount, chunkCount);
        return true;
    }

    internal bool TryAddChunk(JsonElement root)
    {
        var pending = _pending;
        if (pending is null || !TryGetInt64(root, "revision", out var revision) ||
            revision != pending.Revision ||
            !TryGetInt32(root, "index", out var index) ||
            index < 0 || index >= pending.ChunkCount ||
            !root.TryGetProperty("workspaceIds", out var ids) ||
            ids.ValueKind != JsonValueKind.Array ||
            !root.TryGetProperty("profileUsage", out var profiles) ||
            profiles.ValueKind != JsonValueKind.Array)
        {
            _pending = null;
            return false;
        }

        if (!pending.ReceivedChunks.Add(index) ||
            ids.GetArrayLength() != ExpectedChunkSize(pending.WorkspaceIdCount, index) ||
            profiles.GetArrayLength() != ExpectedChunkSize(pending.ProfileCount, index))
        {
            _pending = null;
            return false;
        }

        foreach (var entry in ids.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.String)
            {
                _pending = null;
                return false;
            }

            var id = entry.GetString();
            if (id is null || !IsSafeWorkspaceId(id) || !pending.WorkspaceIds.Add(id))
            {
                _pending = null;
                return false;
            }
        }

        foreach (var entry in profiles.EnumerateArray())
        {
            if (!ProfileUsageSnapshot.TryAddEntry(entry, pending.ProfileUsage, ref pending.TotalProfileCards))
            {
                _pending = null;
                return false;
            }
            pending.ProfileEntriesReceived++;
        }

        return true;
    }

    internal bool TryCommit(JsonElement root, out WorkspaceSnapshotCommit? snapshot)
    {
        snapshot = null;
        var pending = _pending;
        if (pending is null || !TryGetInt64(root, "revision", out var revision) ||
            revision != pending.Revision) return false;

        _pending = null;
        if (pending.ReceivedChunks.Count != pending.ChunkCount ||
            pending.WorkspaceIds.Count != pending.WorkspaceIdCount ||
            pending.ProfileEntriesReceived != pending.ProfileCount ||
            pending.TotalProfileCards > ProfileUsageSnapshot.MaxWorkspaceCardCount) return false;

        _lastCommittedRevision = pending.Revision;
        snapshot = new WorkspaceSnapshotCommit(
            pending.Revision,
            new HashSet<string>(pending.WorkspaceIds, StringComparer.Ordinal),
            new Dictionary<string, int>(pending.ProfileUsage, StringComparer.OrdinalIgnoreCase));
        return true;
    }

    private static int CountChunks(int entryCount) =>
        (entryCount + ChunkSize - 1) / ChunkSize;

    private static int ExpectedChunkSize(int totalCount, int index) =>
        Math.Min(ChunkSize, Math.Max(0, totalCount - index * ChunkSize));

    private static bool IsSafeWorkspaceId(string value)
    {
        if (value.Length is < 1 or > 80) return false;
        foreach (var character in value)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character is not ('_' or '-'))
                return false;
        }
        return true;
    }

    private static bool TryGetInt32(JsonElement root, string propertyName, out int value)
    {
        value = 0;
        return root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty(propertyName, out var property) &&
            property.TryGetInt32(out value);
    }

    private static bool TryGetInt64(JsonElement root, string propertyName, out long value)
    {
        value = 0;
        return root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty(propertyName, out var property) &&
            property.TryGetInt64(out value);
    }

    private sealed class PendingSnapshot
    {
        internal PendingSnapshot(long revision, int workspaceIdCount, int profileCount, int chunkCount)
        {
            Revision = revision;
            WorkspaceIdCount = workspaceIdCount;
            ProfileCount = profileCount;
            ChunkCount = chunkCount;
            WorkspaceIds = new HashSet<string>(StringComparer.Ordinal);
            ProfileUsage = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        }

        internal long Revision { get; }
        internal int WorkspaceIdCount { get; }
        internal int ProfileCount { get; }
        internal int ChunkCount { get; }
        internal HashSet<string> WorkspaceIds { get; }
        internal Dictionary<string, int> ProfileUsage { get; }
        internal HashSet<int> ReceivedChunks { get; } = new();
        internal int ProfileEntriesReceived { get; set; }
        internal long TotalProfileCards;
    }
}
