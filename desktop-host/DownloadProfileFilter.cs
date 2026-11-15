namespace Nolane.DesktopHost;

internal static class DownloadProfileFilter
{
    public static bool Matches(
        string selectedProfile,
        string? entryProfile,
        bool isPrivate,
        string allProfilesFilter,
        string privateSessionsFilter)
    {
        if (StringComparer.Ordinal.Equals(selectedProfile, allProfilesFilter)) return true;
        if (StringComparer.Ordinal.Equals(selectedProfile, privateSessionsFilter)) return isPrivate;
        if (isPrivate) return false;
        return StringComparer.OrdinalIgnoreCase.Equals(entryProfile ?? "", selectedProfile);
    }
}
