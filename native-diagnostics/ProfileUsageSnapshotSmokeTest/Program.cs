using System.Text.Json;
using Nolane.DesktopHost;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static (bool Success, Dictionary<string, int> Usage) Parse(string json)
{
    using var document = JsonDocument.Parse(json);
    var success = ProfileUsageSnapshot.TryParse(document.RootElement, out var usage);
    return (success, usage);
}

var compactAndLegacy = Parse(
    "[[\"Work\",3],[\"\",2],{\"name\":\"Personal\",\"count\":4},{\"name\":\" work \",\"count\":5}]");
Check(compactAndLegacy.Success, "The parser rejected supported compact or legacy profile entries.");
Check(compactAndLegacy.Usage.Count == 3, "The parser did not keep the three normalized profile groups.");
Check(compactAndLegacy.Usage["Work"] == 8, "Case-insensitive duplicate profile names were not combined.");
Check(compactAndLegacy.Usage[""] == 2, "The Default profile bucket was not preserved.");
Check(compactAndLegacy.Usage["Personal"] == 4, "The legacy object profile entry was not preserved.");

var exactLimit = Parse("[[\"Work\",12000],[\"Personal\",12000]]");
Check(exactLimit.Success && exactLimit.Usage.Values.Sum() == ProfileUsageSnapshot.MaxWorkspaceCardCount,
    "A valid snapshot exactly at the 24,000-card workspace ceiling was rejected.");

var empty = Parse("[]");
Check(empty.Success && empty.Usage.Count == 0, "An empty, valid profile summary did not clear the snapshot.");

var invalidSnapshots = new[]
{
    "[[\"Work\",0]]",
    "[[\"Work\",-1]]",
    "[[\"Work\",1.5]]",
    "[[\"bad/name\",1]]",
    "[[\"trailing.\",1]]",
    "[[42,1]]",
    "[\"Work\",1]",
    "[{\"name\":\"Work\"}]",
    "[[\"Work\",24000],[\"work\",1]]"
};
foreach (var json in invalidSnapshots)
{
    var result = Parse(json);
    Check(!result.Success, "The parser accepted an invalid profile snapshot: " + json);
    Check(result.Usage.Count == 0, "A rejected snapshot leaked partially parsed profile usage.");
}

var tooManyEntries = "[" + string.Join(",", Enumerable.Repeat("[\"Work\",1]", 24001)) + "]";
var oversized = Parse(tooManyEntries);
Check(!oversized.Success && oversized.Usage.Count == 0,
    "A profile summary with more than 24,000 entries was not rejected atomically.");

Console.WriteLine("PASS: compact and legacy summaries, normalized duplicate names, Default bucket, exact quota, invalid input, aggregate overflow and entry-count limits.");
