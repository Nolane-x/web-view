[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\NolaneInfiniteBridge")
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "The current Windows user's Local AppData folder is unavailable."
}

$logDirectory = Join-Path $env:LOCALAPPDATA "Nolane\NativeWebView2\Logs"
$installerLog = Join-Path $logDirectory ("installer-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-InstallLog([string]$Message) {
    $line = (Get-Date -Format o) + " " + $Message
    Add-Content -LiteralPath $installerLog -Value $line -Encoding UTF8
    Write-Host $Message
}

function Get-WebView2RuntimeVersion {
    $clientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    $registryPaths = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId",
        "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$clientId"
    )
    foreach ($registryPath in $registryPaths) {
        try {
            $value = (Get-ItemProperty -LiteralPath $registryPath -Name "pv" -ErrorAction Stop).pv
            $parsed = [version]"0.0.0.0"
            if ([version]::TryParse([string]$value, [ref]$parsed) -and $parsed -gt [version]"0.0.0.0") {
                return $parsed.ToString()
            }
        }
        catch { }
    }
    return $null
}

function Test-HostOwnsBridgePort([int]$ProcessId) {
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $listeners = @(Get-NetTCPConnection -LocalPort 43172 -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -eq $ProcessId })
        return $listeners.Count -gt 0
    }

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.ConnectAsync([System.Net.IPAddress]::Loopback, 43172)
        return $pending.Wait(700) -and $client.Connected
    }
    catch { return $false }
    finally { $client.Dispose() }
}

try {
    $sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
    $targetRoot = [System.IO.Path]::GetFullPath($InstallRoot)
    $sourceExe = Join-Path $sourceRoot "Nolane.DesktopHost.exe"

    $architecture = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    Write-InstallLog "Starting Nolane Infinite native host installation. Windows architecture: $architecture."

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw "This package requires 64-bit Windows."
    }
    if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
        throw "Nolane.DesktopHost.exe was not found beside this installer. Extract the complete Windows ZIP first."
    }

    $runtimeVersion = Get-WebView2RuntimeVersion
    if (-not $runtimeVersion) {
        Write-InstallLog "WebView2 Evergreen Runtime was not found in the expected Microsoft Edge Update registry locations."
        throw "Microsoft Edge WebView2 Runtime is missing. Install the Evergreen Runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and run this installer again."
    }
    Write-InstallLog "Detected Microsoft Edge WebView2 Runtime $runtimeVersion."

    $running = @(Get-Process -Name "Nolane.DesktopHost" -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        Write-Warning "Nolane is currently running. Updating/restarting will close it; finish or cancel active downloads first."
        $answer = Read-Host "Continue? (Y/N)"
        if ($answer -notmatch "^(y|yes)$") {
            Write-InstallLog "Installation cancelled by the user."
            exit 0
        }
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 900
    }

    if (-not $sourceRoot.Equals($targetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $parent = Split-Path -Parent $targetRoot
        $stage = "$targetRoot.staging.$PID"
        $backup = "$targetRoot.backup.$PID"
        New-Item -ItemType Directory -Path $parent -Force | Out-Null

        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        New-Item -ItemType Directory -Path $stage -Force | Out-Null

        try {
            Get-ChildItem -LiteralPath $sourceRoot -Force |
                Where-Object {
                    $_.Name -notin @(
                        "Install-NolaneInfinite.ps1",
                        "Install-NolaneInfinite.cmd",
                        "Uninstall-NolaneInfinite.ps1",
                        "Uninstall-NolaneInfinite.cmd",
                        "Diagnose-NolaneInfinite.ps1",
                        "Diagnose-NolaneInfinite.cmd"
                    )
                } |
                ForEach-Object {
                    Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
                }

            if (-not (Test-Path -LiteralPath (Join-Path $stage "Nolane.DesktopHost.exe") -PathType Leaf)) {
                throw "The staged installation is missing Nolane.DesktopHost.exe."
            }

            if (Test-Path -LiteralPath $targetRoot) {
                Move-Item -LiteralPath $targetRoot -Destination $backup
            }
            try {
                Move-Item -LiteralPath $stage -Destination $targetRoot
            }
            catch {
                if (Test-Path -LiteralPath $backup) {
                    Move-Item -LiteralPath $backup -Destination $targetRoot
                }
                throw
            }
            if (Test-Path -LiteralPath $backup) {
                Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        finally {
            if (Test-Path -LiteralPath $stage) {
                Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $installedExe = Join-Path $targetRoot "Nolane.DesktopHost.exe"
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
        throw "The Nolane background bridge is not installed at the expected location."
    }
    Write-InstallLog "Host files installed. Starting the background process."

    $programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
    if (-not [string]::IsNullOrWhiteSpace($programs)) {
        New-Item -ItemType Directory -Path $programs -Force | Out-Null
        $shortcut = Join-Path $programs "Nolane Infinite.url"
        @(
            "[InternetShortcut]"
            "URL=https://nolane-x.github.io/web-view/"
        ) | Set-Content -LiteralPath $shortcut -Encoding ASCII
    }

    $hostProcess = Start-Process -FilePath $installedExe -ArgumentList @("--background") -WorkingDirectory $targetRoot -PassThru
    Write-InstallLog "Started Nolane.DesktopHost.exe (PID $($hostProcess.Id)). Waiting for its loopback listener."

    $bridgeReady = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        $hostProcess.Refresh()
        if ($hostProcess.HasExited) {
            throw "The background host exited during startup (exit code $($hostProcess.ExitCode)). Check the host log at $logDirectory."
        }
        if (Test-HostOwnsBridgePort -ProcessId $hostProcess.Id) {
            $bridgeReady = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $bridgeReady) {
        Write-InstallLog "ERROR: process $($hostProcess.Id) stayed alive but did not own TCP port 43172 within 45 seconds."
        $hostLog = Join-Path $logDirectory "host.log"
        if (Test-Path -LiteralPath $hostLog) {
            Write-Host ""
            Write-Host "--- Recent native host log ---"
            Get-Content -LiteralPath $hostLog -Tail 35
            Write-Host "--- End native host log ---"
        }
        throw "The host process started but its local bridge did not become ready. Run Diagnose-NolaneInfinite.cmd from this ZIP. Installer log: $installerLog"
    }

    Write-InstallLog "SUCCESS: the Nolane host process owns 127.0.0.1:43172 and the loopback bridge is listening."
    Write-InstallLog "Install folder: $targetRoot"
    Write-InstallLog "Installer log: $installerLog"
    Write-Host ""
    Write-Host "Next: open https://nolane-x.github.io/web-view/ and click Connect Windows bridge."
    Write-Host "When Chrome asks, allow Loopback network access for nolane-x.github.io."
    Write-Host "No administrator permission or Chrome extension is required."
}
catch {
    try { Write-InstallLog ("FAILED: " + $_.Exception.Message) } catch { }
    Write-Host ""
    Write-Host "Nolane Infinite installation failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Installer log: $installerLog"
    throw
}
