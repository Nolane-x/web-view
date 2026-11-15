using System.Text.Json;
using Nolane.DesktopHost;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static JsonDocument Parse(string json) => JsonDocument.Parse(json);

static bool Begin(WorkspaceSnapshotReceiver receiver, string json)
{
    using var document = Parse(json);
    return receiver.TryBegin(document.RootElement);
}

static bool AddChunk(WorkspaceSnapshotReceiver receiver, string json)
{
    using var document = Parse(json);
    return receiver.TryAddChunk(document.RootElement);
}

static bool Commit(WorkspaceSnapshotReceiver receiver, long revision, out WorkspaceSnapshotCommit? snapshot)
{
    using var document = Parse("{\"revision\":" + revision + "}");
    return receiver.TryCommit(document.RootElement, out snapshot);
}

var receiver = new WorkspaceSnapshotReceiver();
const int count = 513;
Check(Begin(receiver, "{\"revision\":1,\"workspaceIdCount\":513,\"profileCount\":513,\"chunkCount\":3}"),
    "The receiver rejected a valid 513-entry snapshot.");

for (var index = 2; index >= 0; index--)
{
    var start = index * WorkspaceSnapshotReceiver.ChunkSize;
    var length = Math.Min(WorkspaceSnapshotReceiver.ChunkSize, count - start);
    var ids = Enumerable.Range(start, length).Select(value => "\"card-" + value + "\"");
    var profiles = Enumerable.Range(start, length).Select(value => "[\"Profile-" + value + "\",1]");
    var json = "{\"revision\":1,\"index\":" + index +
        ",\"workspaceIds\":[" + string.Join(",", ids) +
        "],\"profileUsage\":[" + string.Join(",", profiles) + "]}";
    Check(AddChunk(receiver, json), "The receiver rejected a valid out-of-order chunk " + index + ".");
}
Check(Commit(receiver, 1, out var first), "The complete snapshot did not commit.");
Check(first is not null && first.WorkspaceIds.Count == count && first.ProfileUsage.Count == count,
    "The committed snapshot lost workspace IDs or profile entries.");
Check(first!.ProfileUsage["Profile-512"] == 1, "The last profile entry did not survive chunk assembly.");

// Incomplete snapshots cannot replace an already accepted snapshot.
Check(Begin(receiver, "{\"revision\":2,\"workspaceIdCount\":1,\"profileCount\":1,\"chunkCount\":1}"),
    "The receiver rejected the next monotonic revision.");
Check(!Commit(receiver, 2, out var incomplete) && incomplete is null,
    "The receiver committed an incomplete snapshot.");
Check(first.WorkspaceIds.Count == 513 && first.ProfileUsage.Count == 513,
    "An incomplete next snapshot mutated the previously committed result.");

// Retain support for protocol-v2 legacy object profile entries.
Check(Begin(receiver, "{\"revision\":3,\"workspaceIdCount\":1,\"profileCount\":1,\"chunkCount\":1}"),
    "The receiver rejected a valid compatibility snapshot.");
Check(AddChunk(receiver, "{\"revision\":3,\"index\":0,\"workspaceIds\":[\"legacy-card\"],\"profileUsage\":[{\"name\":\"Default\",\"count\":1}]}"),
    "The receiver rejected the legacy object profile summary.");
Check(Commit(receiver, 3, out var legacy) && legacy!.WorkspaceIds.Contains("legacy-card") &&
      legacy.ProfileUsage["Default"] == 1,
    "The legacy-compatible snapshot did not commit correctly.");
Check(!Begin(receiver, "{\"revision\":3,\"workspaceIdCount\":0,\"profileCount\":0,\"chunkCount\":0}"),
    "The receiver accepted a stale revision after commit.");

// Repeated chunk indices are rejected and cannot commit a partial snapshot.
Check(Begin(receiver, "{\"revision\":4,\"workspaceIdCount\":1,\"profileCount\":0,\"chunkCount\":1}"),
    "The receiver rejected a duplicate-chunk test envelope.");
const string repeatedChunk = "{\"revision\":4,\"index\":0,\"workspaceIds\":[\"one-card\"],\"profileUsage\":[]}";
Check(AddChunk(receiver, repeatedChunk), "The receiver rejected the first valid chunk.");
Check(!AddChunk(receiver, repeatedChunk), "The receiver accepted a repeated chunk index.");
Check(!Commit(receiver, 4, out var repeated) && repeated is null,
    "The receiver committed a snapshot containing a repeated chunk.");

// Invalid and duplicate IDs fail closed.
Check(Begin(receiver, "{\"revision\":5,\"workspaceIdCount\":2,\"profileCount\":0,\"chunkCount\":1}"),
    "The receiver rejected a valid test envelope.");
Check(!AddChunk(receiver, "{\"revision\":4,\"index\":0,\"workspaceIds\":[\"same\",\"same\"],\"profileUsage\":[]}"),
    "The receiver accepted duplicate workspace IDs.");
Check(!Commit(receiver, 4, out var duplicate) && duplicate is null,
    "The receiver committed a snapshot with duplicate IDs.");

Check(Begin(receiver, "{\"revision\":6,\"workspaceIdCount\":1,\"profileCount\":0,\"chunkCount\":1}"),
    "The receiver rejected a second test envelope.");
Check(!AddChunk(receiver, "{\"revision\":6,\"index\":0,\"workspaceIds\":[\"bad/id\"],\"profileUsage\":[]}"),
    "The receiver accepted an unsafe ID.");
Check(!Commit(receiver, 6, out var unsafeSnapshot) && unsafeSnapshot is null,
    "The receiver committed a snapshot with an unsafe ID.");

Check(!Begin(receiver, "{\"revision\":7,\"workspaceIdCount\":24001,\"profileCount\":0,\"chunkCount\":94}"),
    "The receiver accepted an over-quota membership declaration.");
Check(!Begin(receiver, "{\"revision\":7,\"workspaceIdCount\":1,\"profileCount\":1,\"chunkCount\":0}"),
    "The receiver accepted a chunk count inconsistent with declared entries.");

Check(Begin(receiver, "{\"revision\":8,\"workspaceIdCount\":0,\"profileCount\":0,\"chunkCount\":0}"),
    "The receiver rejected a valid empty snapshot.");
Check(Commit(receiver, 8, out var empty) && empty!.WorkspaceIds.Count == 0 && empty.ProfileUsage.Count == 0,
    "The empty snapshot did not commit.");

Console.WriteLine("PASS: revision ordering, 256-entry chunking, out-of-order assembly, atomic commit, legacy profile rows, duplicate/unsafe ID rejection, quota checks and empty snapshots.");
