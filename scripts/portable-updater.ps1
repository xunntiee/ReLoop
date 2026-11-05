param(
  [Parameter(Mandatory = $true)] [string]$ZipPath,
  [Parameter(Mandatory = $true)] [string]$BundlePath,
  [Parameter(Mandatory = $true)] [int]$Port
)

$ErrorActionPreference = "Stop"
$updatesRoot = Split-Path -Parent $ZipPath
$stagePath = Join-Path $updatesRoot ("stage-" + [guid]::NewGuid().ToString("N"))
$backupPath = "$BundlePath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$logPath = Join-Path $updatesRoot "updater.log"

function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message)
}

function Test-PortClosed {
  try {
    Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 2 | Out-Null
    return $false
  } catch {
    return $true
  }
}

function Test-ServerHealthy {
  try {
    $response = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 2
    return $response.service -eq "tool-base" -and $response.status -eq "ok"
  } catch {
    return $false
  }
}

function Start-PortableTool([string]$Path) {
  $startPath = Join-Path $Path "_tool-runtime\start-local-web.ps1"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$startPath`""
  ) -WorkingDirectory $Path -WindowStyle Hidden | Out-Null
}

function Stop-PortableTool([string]$Path) {
  $stopPath = Join-Path $Path "_tool-runtime\stop-local-web.ps1"
  if (Test-Path -LiteralPath $stopPath) {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$stopPath`""
    ) -WorkingDirectory $Path -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 1
  }
}

try {
  Write-UpdateLog "Bat dau cap nhat tu $ZipPath"
  if (-not (Test-Path -LiteralPath $ZipPath)) { throw "Khong tim thay file ZIP." }
  if (-not (Test-Path -LiteralPath $BundlePath)) { throw "Khong tim thay thu muc Tool hien tai." }

  Expand-Archive -LiteralPath $ZipPath -DestinationPath $stagePath -Force
  $newBundle = Join-Path $stagePath "Tool Crawl to Video"
  if (-not (Test-Path -LiteralPath $newBundle)) {
    $newBundle = Get-ChildItem -LiteralPath $stagePath -Directory | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $newBundle -or -not (Test-Path -LiteralPath (Join-Path $newBundle "_tool-runtime\build-manifest.json"))) {
    throw "ZIP khong phai goi portable hop le cua Tool."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $newBundle "_tool-runtime\start-local-web.ps1"))) {
    throw "ZIP thieu launcher Windows."
  }

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-PortClosed)) {
    Start-Sleep -Milliseconds 300
  }
  if (-not (Test-PortClosed)) { throw "Server cu chua dong hoan toan." }

  Move-Item -LiteralPath $BundlePath -Destination $backupPath
  try {
    Move-Item -LiteralPath $newBundle -Destination $BundlePath
    Start-PortableTool $BundlePath

    $healthDeadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $healthDeadline -and -not (Test-ServerHealthy)) {
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-ServerHealthy)) { throw "Ban moi khong khoi dong duoc." }
  } catch {
    Write-UpdateLog "Khoi phuc ban cu do loi: $($_.Exception.Message)"
    if (Test-Path -LiteralPath $BundlePath) {
      Stop-PortableTool $BundlePath
      Move-Item -LiteralPath $BundlePath -Destination ("$BundlePath.failed") -Force
    }
    Move-Item -LiteralPath $backupPath -Destination $BundlePath -Force
    Start-PortableTool $BundlePath
    throw
  }

  Remove-Item -LiteralPath $stagePath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
  Write-UpdateLog "Cap nhat thanh cong. Backup duoc giu tai $backupPath"
} catch {
  Write-UpdateLog "Cap nhat that bai: $($_.Exception.Message)"
  exit 1
}
