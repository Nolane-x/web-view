using Nolane.DesktopHost;

static void Check(bool actual, bool expected, string label)
{
    if (actual != expected) throw new InvalidOperationException(
        $"Profile filter '{label}' expected {expected}, received {actual}.");
}

const string all = "\0all";
const string privateSessions = "\0private";

Check(DownloadProfileFilter.Matches(all, "Work", false, all, privateSessions), true, "All includes Work");
Check(DownloadProfileFilter.Matches(all, "", false, all, privateSessions), true, "All includes Default");
Check(DownloadProfileFilter.Matches(all, "Work", true, all, privateSessions), true, "All includes Private");
Check(DownloadProfileFilter.Matches("", null, false, all, privateSessions), true, "Default normalizes missing profile");
Check(DownloadProfileFilter.Matches("", "", false, all, privateSessions), true, "Default matches empty profile");
Check(DownloadProfileFilter.Matches("Work", "work", false, all, privateSessions), true, "Named profile matching is case-insensitive");
Check(DownloadProfileFilter.Matches("Work", "Personal", false, all, privateSessions), false, "Named profiles stay isolated");
Check(DownloadProfileFilter.Matches("Work", "Work", true, all, privateSessions), false, "Private sessions do not enter named profile lists");
Check(DownloadProfileFilter.Matches(privateSessions, "Work", true, all, privateSessions), true, "Private filter includes private sessions");
Check(DownloadProfileFilter.Matches(privateSessions, "Work", false, all, privateSessions), false, "Private filter excludes persistent profiles");

Console.WriteLine("PASS: All, Default, named and Private Downloads filters remain isolated.");
