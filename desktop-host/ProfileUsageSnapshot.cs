using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Nolane.DesktopHost;

internal static class ProfileUsageSnapshot
{
    internal const int MaxWorkspaceCardCount = 12 * 2000;

    internal static bool TryParse(JsonElement profileUsage, out Dictionary<string, int> usage)
    {
        usage = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (profileUsage.ValueKind != JsonValueKind.Array ||
            profileUsage.GetArrayLength() > MaxWorkspaceCardCount) return false;

        var candidate = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        long totalCount = 0;
        foreach (var entry in profileUsage.EnumerateArray())
        {
            JsonElement nameProperty;
            JsonElement countProperty;
            if (entry.ValueKind == JsonValueKind.Array && entry.GetArrayLength() == 2)
            {
                nameProperty = entry[0];
                countProperty = entry[1];
            }
            else if (entry.ValueKind == JsonValueKind.Object &&
                     entry.TryGetProperty("name", out var objectName) &&
                     entry.TryGetProperty("count", out var objectCount))
            {
                // Preserve protocol-v2 compatibility with the former object format.
                nameProperty = objectName;
                countProperty = objectCount;
            }
            else
            {
                return false;
            }

            if (nameProperty.ValueKind != JsonValueKind.String ||
                !countProperty.TryGetInt32(out var count) ||
                count < 1 || count > MaxWorkspaceCardCount) return false;

            var rawName = nameProperty.GetString();
            if (rawName is null) return false;
            var normalized = rawName.Trim();
            if (!IsSafeProfileName(normalized)) return false;

            totalCount += count;
            if (totalCount > MaxWorkspaceCardCount) return false;

            // A profile name is case-insensitive in the native host. Aggregate
            // using Int64 first, then narrow only after applying the global cap.
            var combined = (long)candidate.GetValueOrDefault(normalized) + count;
            if (combined > MaxWorkspaceCardCount) return false;
            candidate[normalized] = (int)combined;
        }

        usage = candidate;
        return true;
    }

    private static bool IsSafeProfileName(string value)
    {
        if (value.Length > 64 || (value.Length > 0 && (value[^1] == '.' || value[^1] == ' ')))
            return false;

        foreach (var character in value)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character is not (' ' or '_' or '-'))
                return false;
        }

        return true;
    }
}
