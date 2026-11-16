$ErrorActionPreference = "Continue"
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop)) {
    $desktop = $env:TEMP
}
$reportPath = Join-Path $desktop "Nolane-Infinite-Diagnostics.txt"
$logDirectory = Join-Path $env:LOCALAPPDATA "Nolane\NativeWebView2\Logs"
$hostLog = Join-Path $logDirectory "host.log"
$clientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$runtimeVersion = $null

foreach ($registryPath in @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$clientId"
)) {
    try {
        $value = (Get-ItemProperty -LiteralPath $registryPath -Name "pv" -ErrorAction Stop).pv
        if ($value) { $runtimeVersion = [string]$value; break }
    }
    catch { }
}

$hostProcesses = @(Get-Process -Name "Nolane.DesktopHost" -ErrorAction SilentlyContinue)
$listeners = @()
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $listeners = @(Get-NetTCPConnection -LocalPort 43172 -State Listen -ErrorAction SilentlyContinue)
}
$installedExe = Join-Path $env:LOCALAPPDATA "Programs\NolaneInfiniteBridge\Nolane.DesktopHost.exe"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("NOLANE INFINITE — WINDOWS DIAGNOSTICS")
$lines.Add("Generated: $(Get-Date -Format o)")
$lines.Add("OS: $([Environment]::OSVersion.VersionString)")
$lines.Add("64-bit OS: $([Environment]::Is64BitOperatingSystem)")
$lines.Add("PowerShell: $($PSVersionTable.PSVersion)")
$lines.Add("WebView2 Evergreen Runtime: $(if ($runtimeVersion) { $runtimeVersion } else { 'NOT DETECTED' })")
$lines.Add("Installed host executable: $(if (Test-Path -LiteralPath $installedExe) { 'present' } else { 'missing' })")
$lines.Add("Host processes: $(if ($hostProcesses.Count) { ($hostProcesses | ForEach-Object { 'PID ' + $_.Id + ' / ' + $_.ProcessName }) -join '; ' } else { 'none' })")
if ($listeners.Count) {
    foreach ($listener in $listeners) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        $lines.Add("TCP 43172 listener: PID $($listener.OwningProcess) / $($owner.ProcessName)")
    }
}
else {
    $lines.Add("TCP 43172 listener: none detected (or Get-NetTCPConnection unavailable)")
}
$lines.Add("")
$lines.Add("BROWSER CHECK")
$lines.Add("- In Chrome/Edge, open the site settings for https://nolane-x.github.io/")
$lines.Add("- Allow Loopback network access (the permission for 127.0.0.1).")
$lines.Add("- Reload the Nolane page, then click Connect Windows bridge.")
$lines.Add("- Do not use a localhost development server; the host only trusts the published GitHub Pages origin.")
$lines.Add("")
$lines.Add("RECENT HOST LOG")
if (Test-Path -LiteralPath $hostLog) {
    $lines.AddRange([string[]](Get-Content -LiteralPath $hostLog -Tail 80))
}
else {
    $lines.Add("No host.log exists. The executable may not have started, or startup failed before diagnostics initialization.")
}
$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Diagnostics report created: $reportPath" -ForegroundColor Green
Write-Host "Review the report. It contains process and startup-log details; check it before sharing."
Write-Host ""
Get-Content -LiteralPath $reportPath
Write-Host ""
Read-Host "Press Enter to close"
