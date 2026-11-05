param(
  [string]$BundleRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($BundleRoot)) {
  $BundleRoot = Join-Path $repoRoot "release\Tool Crawl to Video"
}
$runtimeRoot = Join-Path $BundleRoot "_tool-runtime"
$startScript = Join-Path $runtimeRoot "start-local-web.ps1"
$stopScript = Join-Path $runtimeRoot "stop-local-web.ps1"
$configExample = Join-Path $runtimeRoot "config.example.json"
foreach ($requiredPath in @($startScript, $stopScript, $configExample)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Portable lifecycle smoke is missing: $requiredPath"
  }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) (
  "ToolBase-lifecycle-{0}" -f [Guid]::NewGuid().ToString("N")
)
$testLocalAppData = Join-Path $testRoot "LocalAppData"
$toolDataRoot = Join-Path $testLocalAppData "ToolBase"
$configPath = Join-Path $toolDataRoot "config.json"
$previousLocalAppData = $env:LOCALAPPDATA
$previousAppData = $env:APPDATA

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

try {
  New-Item -ItemType Directory -Force -Path $toolDataRoot | Out-Null
  $config = Get-Content -LiteralPath $configExample -Raw | ConvertFrom-Json
  $config.server.port = $port
  [IO.File]::WriteAllText(
    $configPath,
    ($config | ConvertTo-Json -Depth 20),
    [Text.UTF8Encoding]::new($false)
  )

  $env:LOCALAPPDATA = $testLocalAppData
  $env:APPDATA = Join-Path $testRoot "AppData"

  & powershell -NoProfile -ExecutionPolicy Bypass -File $startScript -NoBrowser -SkipDesktopShortcut
  if ($LASTEXITCODE -ne 0) {
    throw "Portable start script failed with exit code $LASTEXITCODE."
  }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 5
  if ($health.service -ne "tool-base" -or $health.status -ne "ok") {
    throw "Portable health response is invalid."
  }

  $configResponse = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/config" -TimeoutSec 15
  $resolvedUserRoot = [IO.Path]::GetFullPath([string]$configResponse.runtime.userDataRoot).TrimEnd("\\")
  $expectedUserRoot = [IO.Path]::GetFullPath($toolDataRoot).TrimEnd("\\")
  if (-not [string]::Equals($resolvedUserRoot, $expectedUserRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Portable server loaded the wrong user-data root: $resolvedUserRoot"
  }
  $licenseEndpoints = @($configResponse.config.license.verifyUrls)
  if ($licenseEndpoints.Count -ne 1 -or $licenseEndpoints[0] -ne "https://portal.monback.app/api/v1/license/verify") {
    throw "Portable config must use only the portal.monback.app license endpoint."
  }

  $pidPath = Join-Path $toolDataRoot "logs\local-web-server.pid"
  $firstPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
  & powershell -NoProfile -ExecutionPolicy Bypass -File $startScript -NoBrowser -SkipDesktopShortcut
  if ($LASTEXITCODE -ne 0) {
    throw "Second portable start should reuse the running server."
  }
  $secondPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ($firstPid -ne $secondPid) {
    throw "Second portable start created another server process."
  }

  $secondListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $secondListener.Start()
  $changedPort = ([Net.IPEndPoint]$secondListener.LocalEndpoint).Port
  $secondListener.Stop()
  $config.server.port = $changedPort
  [IO.File]::WriteAllText(
    $configPath,
    ($config | ConvertTo-Json -Depth 20),
    [Text.UTF8Encoding]::new($false)
  )
  & powershell `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $startScript `
    -NoBrowser `
    -SkipDesktopShortcut `
    -SuppressErrorDialog
  if ($LASTEXITCODE -eq 0) {
    throw "Portable start should reject a port change while the old server is running."
  }
  if (-not (Get-Process -Id $firstPid -ErrorAction SilentlyContinue)) {
    throw "Port-change protection stopped the existing server unexpectedly."
  }
  $config.server.port = $port
  [IO.File]::WriteAllText(
    $configPath,
    ($config | ConvertTo-Json -Depth 20),
    [Text.UTF8Encoding]::new($false)
  )

  $wrongTokenRejected = $false
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:$port/api/system/shutdown" `
      -Headers @{ "x-tool-shutdown-token" = "invalid-token" } `
      -TimeoutSec 5 | Out-Null
  } catch {
    $wrongTokenRejected = $_.Exception.Response.StatusCode.value__ -eq 403
  }
  if (-not $wrongTokenRejected) {
    throw "Shutdown endpoint accepted an invalid token."
  }

  & powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript
  if ($LASTEXITCODE -ne 0) {
    throw "Portable stop script failed with exit code $LASTEXITCODE."
  }
  if (Get-Process -Id $firstPid -ErrorAction SilentlyContinue) {
    throw "Portable server process is still running after STOP."
  }

  Write-Host "smoke:portable-lifecycle-runtime ok"
} finally {
  try {
    if (Test-Path -LiteralPath $stopScript) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null
    }
  } catch {
  }
  $env:LOCALAPPDATA = $previousLocalAppData
  $env:APPDATA = $previousAppData
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
