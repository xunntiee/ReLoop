param(
  [string]$ReleaseLabel = "v1"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeWorkdir = Join-Path $root ".local-web-runtime"
$releaseBase = Join-Path $root "release"
$bundleRoot = Join-Path $releaseBase "Tool Crawl to Video"
$runtimeBundleRoot = Join-Path $bundleRoot "_tool-runtime"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $releaseBase ("ToolCrawlToVideo-{0}-{1}.zip" -f $ReleaseLabel, $stamp)
$zipWorkPath = Join-Path $runtimeWorkdir ("ToolCrawlToVideo-{0}-{1}.tmp.zip" -f $ReleaseLabel, $stamp)
$rootPackageJsonPath = Join-Path $root "package.json"
$serverPackageJsonPath = Join-Path $root "apps\server\package.json"
$serverDistPath = Join-Path $root "apps\server\dist"
$webDistPath = Join-Path $root "apps\web\dist"
$ffmpegSourceDir = Join-Path $root "vendor\ffmpeg\bin"
$iconSourcePath = Join-Path $root "assets\image9.ico"
$configExamplePath = Join-Path $root "config.example.json"

function Write-Step([string]$Message) {
  Write-Host ("==> {0}" -f $Message)
}

function New-PortableZipArchive {
  param(
    [string]$SourceDirectory,
    [string]$DestinationPath,
    [string]$TopLevelName
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path.TrimEnd("\")
  $archive = [System.IO.Compression.ZipFile]::Open(
    $DestinationPath,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force) {
      $relativePath = $file.FullName.Substring($sourceRoot.Length).TrimStart("\")
      $entryName = ("{0}/{1}" -f $TopLevelName, $relativePath).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $file.FullName,
        $entryName,
        [System.IO.Compression.CompressionLevel]::Fastest
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
}

function New-RuntimePackageJson {
  param(
    [string]$RootPackagePath,
    [string]$SourcePath,
    [string]$DestinationPath
  )

  $rootPackage = Get-Content $RootPackagePath -Raw | ConvertFrom-Json
  $serverPackage = Get-Content $SourcePath -Raw | ConvertFrom-Json
  $catalog = $rootPackage.workspaces.catalog
  $runtimeDependencies = [ordered]@{}

  foreach ($property in $serverPackage.dependencies.PSObject.Properties) {
    if ($property.Name -eq "@tool-base/config") {
      continue
    }
    if ($property.Name -eq "playwright") {
      $installedPlaywrightPackagePath = Join-Path (Split-Path -Parent $SourcePath) "node_modules\playwright\package.json"
      if (Test-Path $installedPlaywrightPackagePath) {
        $installedPlaywrightPackage = Get-Content $installedPlaywrightPackagePath -Raw | ConvertFrom-Json
        if ($installedPlaywrightPackage.version) {
          $runtimeDependencies[$property.Name] = [string]$installedPlaywrightPackage.version
          continue
        }
      }
    }
    if ($property.Value -eq "workspace:*") {
      continue
    }
    if ($property.Value -eq "catalog:") {
      $catalogValue = $catalog.($property.Name)
      if (-not $catalogValue) {
        throw "Khong tim thay version catalog cho $($property.Name)"
      }
      $runtimeDependencies[$property.Name] = $catalogValue
      continue
    }
    $runtimeDependencies[$property.Name] = $property.Value
  }

  $runtimePackage = [ordered]@{
    name = "post-to-video-local-web-runtime"
    private = $true
    version = "1.0.0"
    type = "module"
    dependencies = $runtimeDependencies
  }

  $runtimeJson = $runtimePackage | ConvertTo-Json -Depth 10
  Set-Content -LiteralPath $DestinationPath -Value "$runtimeJson`n" -Encoding UTF8
}

function Get-NodeExecutablePath {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Khong tim thay node.exe tren may build."
  }
  $majorVersion = [int]((& $command.Source -p "Number(process.versions.node.split('.')[0])").Trim())
  if ($majorVersion -lt 20) {
    throw "Node.js tren may build qua cu. Can Node.js 20 tro len."
  }
  return $command.Source
}

function Assert-PortableBundleNotRunning {
  param([string]$BundlePath)

  $runtimePath = Join-Path $BundlePath "_tool-runtime"
  if (-not (Test-Path $runtimePath)) {
    return
  }

  $resolvedRuntimePath = (Resolve-Path -LiteralPath $runtimePath).Path.TrimEnd("\") + "\"
  $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
      ([string]$_.ExecutablePath).StartsWith(
        $resolvedRuntimePath,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } |
    Select-Object -First 1
  if ($running) {
    throw "Ban portable cu van dang chay (PID $($running.ProcessId)). Hay bam STOP TOOL.cmd trong ban cu, sau do dong goi lai."
  }
}

Assert-PortableBundleNotRunning -BundlePath $bundleRoot

Write-Step "Building workspace"
Push-Location $root
try {
  & bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "Workspace build failed."
  }
} finally {
  Pop-Location
}

Write-Step "Preparing minimal runtime dependencies for local web bundle"
if (Test-Path $runtimeWorkdir) {
  Remove-Item -LiteralPath $runtimeWorkdir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $runtimeWorkdir | Out-Null
New-RuntimePackageJson `
  -RootPackagePath $rootPackageJsonPath `
  -SourcePath $serverPackageJsonPath `
  -DestinationPath (Join-Path $runtimeWorkdir "package.json")

Push-Location $runtimeWorkdir
try {
  # Keep npm's cache and temporary extraction files beside the workspace.
  $npmCacheDir = Join-Path $runtimeWorkdir '.npm-cache'
  $npmTempDir = Join-Path $runtimeWorkdir '.npm-temp'
  New-Item -ItemType Directory -Force -Path $npmCacheDir, $npmTempDir | Out-Null
  $previousNpmCache = $env:npm_config_cache
  $previousNpmTemp = $env:npm_config_tmp
  $previousTemp = $env:TEMP
  $previousTmp = $env:TMP
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
  $env:npm_config_audit = "false"
  $env:npm_config_fund = "false"
  $env:npm_config_cache = $npmCacheDir
  $env:npm_config_tmp = $npmTempDir
  $env:TEMP = $npmTempDir
  $env:TMP = $npmTempDir
  & npm install --omit=dev --no-package-lock
  if ($LASTEXITCODE -ne 0) {
    throw "npm install for local web runtime failed."
  }
} finally {
  Remove-Item Env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD -ErrorAction SilentlyContinue
  Remove-Item Env:npm_config_audit -ErrorAction SilentlyContinue
  Remove-Item Env:npm_config_fund -ErrorAction SilentlyContinue
  if ($null -eq $previousNpmCache) { Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue } else { $env:npm_config_cache = $previousNpmCache }
  if ($null -eq $previousNpmTemp) { Remove-Item Env:npm_config_tmp -ErrorAction SilentlyContinue } else { $env:npm_config_tmp = $previousNpmTemp }
  if ($null -eq $previousTemp) { Remove-Item Env:TEMP -ErrorAction SilentlyContinue } else { $env:TEMP = $previousTemp }
  if ($null -eq $previousTmp) { Remove-Item Env:TMP -ErrorAction SilentlyContinue } else { $env:TMP = $previousTmp }
  Pop-Location
}

if (Test-Path $npmCacheDir) {
  Remove-Item -LiteralPath $npmCacheDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $npmTempDir) {
  Remove-Item -LiteralPath $npmTempDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $bundleRoot) {
  Assert-PortableBundleNotRunning -BundlePath $bundleRoot
  Write-Step "Cleaning previous local web bundle"
  Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}

Write-Step "Preparing local web handoff folder"
New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeBundleRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeBundleRoot "vendor\ffmpeg\bin") | Out-Null

Copy-Item -Path $serverDistPath -Destination (Join-Path $runtimeBundleRoot "server-dist") -Recurse
Copy-Item -Path $webDistPath -Destination (Join-Path $runtimeBundleRoot "web-dist") -Recurse
Copy-Item -Path (Join-Path $runtimeWorkdir "node_modules") -Destination (Join-Path $runtimeBundleRoot "node_modules") -Recurse
Copy-Item -LiteralPath $configExamplePath -Destination (Join-Path $runtimeBundleRoot "config.example.json")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "portable-updater.ps1") -Destination (Join-Path $runtimeBundleRoot "portable-updater.ps1")
Copy-Item -LiteralPath (Get-NodeExecutablePath) -Destination (Join-Path $runtimeBundleRoot "node.exe")
if (Test-Path $iconSourcePath) {
  Copy-Item -LiteralPath $iconSourcePath -Destination (Join-Path $runtimeBundleRoot "image9.ico")
}

foreach ($binaryName in @("ffmpeg.exe", "ffprobe.exe")) {
  $source = Join-Path $ffmpegSourceDir $binaryName
  if (-not (Test-Path $source)) {
    throw "Khong tim thay $binaryName trong vendor\\ffmpeg\\bin"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeBundleRoot "vendor\ffmpeg\bin\$binaryName")
}

$startScript = @'
param(
  [switch]$NoBrowser,
  [switch]$SkipDesktopShortcut,
  [switch]$SuppressErrorDialog
)

$ErrorActionPreference = "Stop"

function Show-LauncherError {
  param([string]$Message)

  $base = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $env:APPDATA
  } else {
    $env:LOCALAPPDATA
  }
  $errorLogDir = Join-Path $base "ToolBase\logs"
  New-Item -ItemType Directory -Force -Path $errorLogDir -ErrorAction SilentlyContinue | Out-Null
  $errorLogPath = Join-Path $errorLogDir "launcher-error.log"
  Add-Content -LiteralPath $errorLogPath -Encoding UTF8 -Value (
    "[{0}] {1}" -f (Get-Date -Format "s"), $Message
  ) -ErrorAction SilentlyContinue

  if ($SuppressErrorDialog) {
    Write-Host $Message
    Write-Host "Chi tiet: $errorLogPath"
    return
  }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "$Message`r`n`r`nChi tiet: $errorLogPath",
      "Post to Video khong the khoi dong",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    Write-Host $Message
    Write-Host "Chi tiet: $errorLogPath"
  }
}

trap {
  Show-LauncherError -Message $_.Exception.Message
  exit 1
}

function Find-SystemBrowser {
  $localAppData = [string]$env:LOCALAPPDATA
  $programFiles = [string]$env:PROGRAMFILES
  $programFilesX86 = [string]${env:PROGRAMFILES(X86)}
  $candidates = @(
    (Join-Path $localAppData "Google\Chrome\Application\chrome.exe"),
    (Join-Path $programFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe"),
    (Join-Path $localAppData "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $programFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe")
  )

  foreach ($executableName in @("chrome.exe", "msedge.exe")) {
    foreach ($key in @(
      "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths\$executableName",
      "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths\$executableName"
    )) {
      try {
        $registryPath = [string](Get-ItemPropertyValue -LiteralPath $key -Name "(default)" -ErrorAction Stop)
        if ($registryPath) {
          $candidates += [Environment]::ExpandEnvironmentVariables($registryPath.Trim('"'))
        }
      } catch {
      }
    }
  }

  return $candidates |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1
}

function Read-PortFromConfig {
  param([string]$ConfigPath)
  if (-not (Test-Path $ConfigPath)) {
    return 34577
  }

  try {
    $raw = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $parsed = [int]($raw.server.port)
    if ($parsed -gt 0) {
      return $parsed
    }
  } catch {
  }

  return 34577
}

function Test-ServerHealthy {
  param([int]$Port)
  try {
    $response = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 2
    return $response.service -eq "tool-base" -and $response.status -eq "ok"
  } catch {
    return $false
  }
}

function Get-ProcessCommandLine {
  param([int]$PidValue)
  try {
    $instance = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $PidValue) -ErrorAction Stop
    return [string]$instance.CommandLine
  } catch {
    return ""
  }
}

function Test-ManagedServerProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$NodeExe,
    [string]$ServerEntryPath
  )

  if (-not $Process) {
    return $false
  }

  try {
    $expectedNode = (Resolve-Path -LiteralPath $NodeExe).Path
    $actualNode = [string]$Process.Path
    if ([string]::IsNullOrWhiteSpace($actualNode)) {
      return $false
    }
    if (-not ([string]::Equals($actualNode, $expectedNode, [System.StringComparison]::OrdinalIgnoreCase))) {
      return $false
    }

    $expectedEntry = (Resolve-Path -LiteralPath $ServerEntryPath).Path
    $commandLine = Get-ProcessCommandLine $Process.Id
    return $commandLine.IndexOf($expectedEntry, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } catch {
    return $false
  }
}

function Get-ManagedServerProcess {
  param(
    [string]$PidPath,
    [string]$NodeExe,
    [string]$ServerEntryPath
  )

  if (-not (Test-Path $PidPath)) {
    return $null
  }

  try {
    $pidValue = [int](Get-Content -LiteralPath $PidPath -Raw).Trim()
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if (Test-ManagedServerProcess -Process $process -NodeExe $NodeExe -ServerEntryPath $ServerEntryPath) {
      return $process
    }
  } catch {
  }

  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
  return $null
}

function Get-ListeningPortProcess {
  param([int]$Port)
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) {
      return $null
    }
    return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

function Remove-StalePid {
  param([string]$PidPath)
  if (-not (Test-Path $PidPath)) {
    return
  }

  try {
    $pidValue = [int](Get-Content -LiteralPath $PidPath -Raw).Trim()
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if (-not $process) {
      Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
  }
}

function Ensure-DesktopShortcut {
  param(
    [string]$PackageRoot,
    [string]$UserDataRoot
  )

  try {
    $desktopDir = [Environment]::GetFolderPath("Desktop")
    if ([string]::IsNullOrWhiteSpace($desktopDir)) {
      return $null
    }

    $bundleRoot = Split-Path -Parent $PackageRoot
    $shortcutPath = Join-Path $desktopDir "Post to Video.lnk"
    $targetPath = Join-Path $bundleRoot "OPEN TOOL.cmd"
    $workingDirectory = $bundleRoot
    $iconCandidatePath = Join-Path $PackageRoot "image9.ico"
    $iconStoreDir = Join-Path $UserDataRoot "assets"
    $iconStorePath = Join-Path $iconStoreDir "image9.ico"
    if (Test-Path $iconCandidatePath) {
      New-Item -ItemType Directory -Force -Path $iconStoreDir | Out-Null
      $shouldCopyIcon = $true
      if (Test-Path $iconStorePath) {
        try {
          $sourceIcon = Get-Item -LiteralPath $iconCandidatePath
          $storedIcon = Get-Item -LiteralPath $iconStorePath
          $shouldCopyIcon = $sourceIcon.Length -ne $storedIcon.Length -or $sourceIcon.LastWriteTimeUtc -gt $storedIcon.LastWriteTimeUtc
        } catch {
          $shouldCopyIcon = $true
        }
      }
      if ($shouldCopyIcon) {
        Copy-Item -LiteralPath $iconCandidatePath -Destination $iconStorePath -Force
      }
    }
    $iconPath = if (Test-Path $iconStorePath) { $iconStorePath } elseif (Test-Path $iconCandidatePath) { $iconCandidatePath } else { Join-Path $PackageRoot "node.exe" }
    $description = "Mo Post to Video local tool"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)

    $needsSave = $false
    if ($shortcut.TargetPath -ne $targetPath) {
      $shortcut.TargetPath = $targetPath
      $needsSave = $true
    }
    if ($shortcut.WorkingDirectory -ne $workingDirectory) {
      $shortcut.WorkingDirectory = $workingDirectory
      $needsSave = $true
    }
    if ($shortcut.Description -ne $description) {
      $shortcut.Description = $description
      $needsSave = $true
    }
    if ($shortcut.IconLocation -ne $iconPath) {
      $shortcut.IconLocation = $iconPath
      $needsSave = $true
    }

    if ($needsSave -or -not (Test-Path $shortcutPath)) {
      $shortcut.Save()
    }

    return $shortcutPath
  } catch {
    $warningPath = Join-Path $UserDataRoot "logs\desktop-shortcut-warning.log"
    $warningMessage = "[{0}] Khong tao duoc shortcut Desktop: {1}" -f (Get-Date -Format "s"), $_.Exception.Message
    Add-Content -LiteralPath $warningPath -Value $warningMessage -Encoding UTF8
    return $null
  }
}

function Start-LocalServer(
  [string]$NodeExe,
  [string]$ServerEntryPath,
  [string]$PackageRoot,
  [string]$ConfigPath,
  [string]$WebDistPath,
  [string]$FfmpegBinPath,
  [string]$UserDataRoot,
  [string]$ShutdownToken,
  [string]$StdoutPath,
  [string]$StderrPath
) {
  $previousConfigPath = $env:SERVER_CONFIG_PATH
  $previousWebDistPath = $env:WEB_DIST_PATH
  $previousPath = $env:PATH
  $previousShutdownToken = $env:TOOL_SHUTDOWN_TOKEN
  $previousUserDataRoot = $env:TOOL_USER_DATA_ROOT
  $quotedServerEntryPath = "`"$ServerEntryPath`""

  try {
    $env:SERVER_CONFIG_PATH = $ConfigPath
    $env:WEB_DIST_PATH = $WebDistPath
    $env:PATH = "$FfmpegBinPath;$previousPath"
    $env:TOOL_SHUTDOWN_TOKEN = $ShutdownToken
    $env:TOOL_USER_DATA_ROOT = $UserDataRoot
    $env:TOOL_BUNDLE_ROOT = Split-Path -Parent $packageRoot
    $env:TOOL_UPDATE_SCRIPT = Join-Path $packageRoot "portable-updater.ps1"

    return Start-Process `
      -FilePath $NodeExe `
      -ArgumentList @($quotedServerEntryPath) `
      -WorkingDirectory $PackageRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $StdoutPath `
      -RedirectStandardError $StderrPath `
      -PassThru
  } finally {
    if ($null -eq $previousConfigPath) {
      Remove-Item Env:SERVER_CONFIG_PATH -ErrorAction SilentlyContinue
    } else {
      $env:SERVER_CONFIG_PATH = $previousConfigPath
    }

    if ($null -eq $previousWebDistPath) {
      Remove-Item Env:WEB_DIST_PATH -ErrorAction SilentlyContinue
    } else {
      $env:WEB_DIST_PATH = $previousWebDistPath
    }

    $env:PATH = $previousPath
    if ($null -eq $previousUserDataRoot) {
      Remove-Item Env:TOOL_USER_DATA_ROOT -ErrorAction SilentlyContinue
    } else {
      $env:TOOL_USER_DATA_ROOT = $previousUserDataRoot
    }

    if ($null -eq $previousShutdownToken) {
      Remove-Item Env:TOOL_SHUTDOWN_TOKEN -ErrorAction SilentlyContinue
    } else {
      $env:TOOL_SHUTDOWN_TOKEN = $previousShutdownToken
    }
  }
}

$packageRoot = $PSScriptRoot
$userRootBase = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  $env:APPDATA
} else {
  $env:LOCALAPPDATA
}
$userDataRoot = Join-Path $userRootBase "ToolBase"
$logsDir = Join-Path $userDataRoot "logs"
$configPath = Join-Path $userDataRoot "config.json"
$exampleConfigPath = Join-Path $packageRoot "config.example.json"
$pidPath = Join-Path $logsDir "local-web-server.pid"
$shutdownTokenPath = Join-Path $logsDir "local-web-server.shutdown-token"
$stdoutPath = Join-Path $logsDir "server.out.log"
$stderrPath = Join-Path $logsDir "server.err.log"
$nodeExe = Join-Path $packageRoot "node.exe"
$serverEntryPath = Join-Path $packageRoot "server-dist\index.mjs"
$webDistPath = Join-Path $packageRoot "web-dist"
$ffmpegBinPath = Join-Path $packageRoot "vendor\ffmpeg\bin"

if (-not (Test-Path $nodeExe)) {
  throw "Khong tim thay node.exe trong goi local web."
}
if (-not (Test-Path $serverEntryPath)) {
  throw "Khong tim thay server-dist\\index.mjs."
}
if (-not (Test-Path $webDistPath)) {
  throw "Khong tim thay web-dist."
}
$systemBrowser = Find-SystemBrowser
if (-not $systemBrowser) {
  throw "Khong tim thay Google Chrome hoac Microsoft Edge. Hay cai dat mot trong hai trinh duyet roi mo lai tool."
}

New-Item -ItemType Directory -Force -Path $userDataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$desktopShortcutPath = $null
if (-not $SkipDesktopShortcut) {
  $desktopShortcutPath = Ensure-DesktopShortcut `
    -PackageRoot $packageRoot `
    -UserDataRoot $userDataRoot
}

if (-not (Test-Path $configPath)) {
  Copy-Item -LiteralPath $exampleConfigPath -Destination $configPath
}

$port = Read-PortFromConfig $configPath
$appUrl = "http://127.0.0.1:$port/app"
$launcherMutex = New-Object System.Threading.Mutex($false, "Local\ToolBase-Launcher")
$hasLauncherMutex = $false

try {
  try {
    $hasLauncherMutex = $launcherMutex.WaitOne([TimeSpan]::FromSeconds(30))
  } catch [System.Threading.AbandonedMutexException] {
    $hasLauncherMutex = $true
  }

  if (-not $hasLauncherMutex) {
    throw "Tool dang duoc mot tien trinh khac khoi dong. Hay doi 30 giay roi thu lai."
  }

  $managedProcess = Get-ManagedServerProcess `
    -PidPath $pidPath `
    -NodeExe $nodeExe `
    -ServerEntryPath $serverEntryPath

  if (-not $managedProcess) {
    $portProcess = Get-ListeningPortProcess $port
    if (Test-ManagedServerProcess -Process $portProcess -NodeExe $nodeExe -ServerEntryPath $serverEntryPath) {
      $managedProcess = $portProcess
      Set-Content -LiteralPath $pidPath -Value $managedProcess.Id -Encoding ASCII
    }
  }

  $serverHealthy = Test-ServerHealthy $port
  if ($managedProcess -and -not $serverHealthy) {
    throw "Da tim thay mot server portable dang chay nhung khong dung port $port. Hay bam STOP TOOL.cmd truoc khi doi port hoac mo ban moi."
  }

  if ($serverHealthy) {
    if ($managedProcess) {
      if (-not $NoBrowser) {
        Start-Process $appUrl | Out-Null
      }
      if ($desktopShortcutPath) {
        Write-Host "Da san shortcut Desktop: $desktopShortcutPath"
      }
      Write-Host "Tool da san sang tai $appUrl"
      exit 0
    }

    throw "Port $port dang duoc mot server Tool Base khac su dung. Hay tat ban local/dev hoac ban portable cu, roi mo lai."
  }

  $portProcess = Get-ListeningPortProcess $port
  if ($portProcess) {
    throw "Khong the khoi dong: port $port dang bi tien trinh $($portProcess.Id) su dung. Hay dong ung dung do hoac doi port tai $configPath."
  }

  Remove-StalePid $pidPath
  $shutdownToken = [Guid]::NewGuid().ToString("N")
  Set-Content -LiteralPath $shutdownTokenPath -Value $shutdownToken -Encoding ASCII

  $process = Start-LocalServer `
    -NodeExe $nodeExe `
    -ServerEntryPath $serverEntryPath `
    -PackageRoot $packageRoot `
    -ConfigPath $configPath `
    -WebDistPath $webDistPath `
    -FfmpegBinPath $ffmpegBinPath `
    -UserDataRoot $userDataRoot `
    -ShutdownToken $shutdownToken `
    -StdoutPath $stdoutPath `
    -StderrPath $stderrPath

  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ASCII

  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500

    if (Test-ServerHealthy $port) {
      if (-not $NoBrowser) {
        Start-Process $appUrl | Out-Null
      }
      if ($desktopShortcutPath) {
        Write-Host "Da san shortcut Desktop: $desktopShortcutPath"
      }
      Write-Host "Tool da san sang tai $appUrl"
      exit 0
    }

    try {
      $process.Refresh()
      if ($process.HasExited) {
        break
      }
    } catch {
      break
    }
  }

  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $shutdownTokenPath -Force -ErrorAction SilentlyContinue
  throw "Khong the khoi dong tool. Xem log tai $stderrPath"
} finally {
  if ($hasLauncherMutex) {
    $launcherMutex.ReleaseMutex()
  }
  $launcherMutex.Dispose()
}
'@

$stopScript = @'
$ErrorActionPreference = "Stop"

function Read-PortFromConfig {
  param([string]$ConfigPath)
  if (-not (Test-Path $ConfigPath)) { return 34577 }
  try {
    $raw = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $parsed = [int]($raw.server.port)
    if ($parsed -gt 0) { return $parsed }
  } catch {
  }
  return 34577
}

function Get-ProcessCommandLine {
  param([int]$PidValue)
  try {
    return [string](Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $PidValue) -ErrorAction Stop).CommandLine
  } catch {
    return ""
  }
}

function Test-ManagedServerProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$NodeExe,
    [string]$ServerEntryPath
  )
  if (-not $Process) { return $false }
  try {
    $expectedNode = (Resolve-Path -LiteralPath $NodeExe).Path
    $expectedEntry = (Resolve-Path -LiteralPath $ServerEntryPath).Path
    if (-not [string]::Equals([string]$Process.Path, $expectedNode, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
    return (Get-ProcessCommandLine $Process.Id).IndexOf($expectedEntry, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } catch {
    return $false
  }
}

function Get-ListeningPortProcess {
  param([int]$Port)
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) { return $null }
    return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

$userRootBase = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  $env:APPDATA
} else {
  $env:LOCALAPPDATA
}
$userDataRoot = Join-Path $userRootBase "ToolBase"
$logsDir = Join-Path $userDataRoot "logs"
$pidPath = Join-Path $logsDir "local-web-server.pid"
$shutdownTokenPath = Join-Path $logsDir "local-web-server.shutdown-token"
$configPath = Join-Path $userDataRoot "config.json"
$packageRoot = $PSScriptRoot
$nodeExe = Join-Path $packageRoot "node.exe"
$serverEntryPath = Join-Path $packageRoot "server-dist\index.mjs"
$port = Read-PortFromConfig $configPath

$stopMutex = New-Object System.Threading.Mutex($false, "Local\ToolBase-Launcher")
$hasStopMutex = $false
try {
  try {
    $hasStopMutex = $stopMutex.WaitOne([TimeSpan]::FromSeconds(35))
  } catch [System.Threading.AbandonedMutexException] {
    $hasStopMutex = $true
  }
  if (-not $hasStopMutex) {
    throw "Tool dang khoi dong hoac mot lenh STOP khac dang chay. Hay thu lai sau."
  }

$process = $null
if (Test-Path $pidPath) {
  try {
    $pidValue = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
    $candidate = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if (Test-ManagedServerProcess -Process $candidate -NodeExe $nodeExe -ServerEntryPath $serverEntryPath) {
      $process = $candidate
    }
  } catch {
  }
}

if (-not $process) {
  $candidate = Get-ListeningPortProcess $port
  if (Test-ManagedServerProcess -Process $candidate -NodeExe $nodeExe -ServerEntryPath $serverEntryPath) {
    $process = $candidate
  }
}

if (-not $process) {
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $shutdownTokenPath -Force -ErrorAction SilentlyContinue
  Write-Host "Khong co server portable nao dang chay."
  exit 0
}

$shutdownRequested = $false
if (Test-Path $shutdownTokenPath) {
  try {
    $token = (Get-Content -LiteralPath $shutdownTokenPath -Raw).Trim()
    if ($token) {
      Invoke-RestMethod `
        -Method Post `
        -Uri ("http://127.0.0.1:{0}/api/system/shutdown" -f $port) `
        -Headers @{ "x-tool-shutdown-token" = $token } `
        -TimeoutSec 5 | Out-Null
      $shutdownRequested = $true
      Write-Host "Dang luu tien do va dung an toan..."
    }
  } catch {
    Write-Host "Khong goi duoc shutdown mem. Se dung theo che do du phong."
  }
}

$waitSeconds = if ($shutdownRequested) { 25 } else { 3 }
$deadline = (Get-Date).AddSeconds($waitSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    break
  }
  Start-Sleep -Milliseconds 250
}

$remaining = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
if ($remaining -and (Test-ManagedServerProcess -Process $remaining -NodeExe $nodeExe -ServerEntryPath $serverEntryPath)) {
  Write-Host "Tool chua dung het sau thoi gian cho. Dang tat cac tien trinh con..."
  if (Get-Command taskkill.exe -ErrorAction SilentlyContinue) {
    & taskkill.exe /PID $remaining.Id /T /F | Out-Null
  } else {
    Stop-Process -Id $remaining.Id -Force -ErrorAction SilentlyContinue
  }
}

Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $shutdownTokenPath -Force -ErrorAction SilentlyContinue
Write-Host "Da tat tool local web."
exit 0
} finally {
  if ($hasStopMutex) {
    $stopMutex.ReleaseMutex()
  }
  $stopMutex.Dispose()
}
'@

$startCmd = @'
@echo off
cd /d "%~dp0"
echo Dang mo Post to Video, vui long doi 5-30 giay...
start "" wscript.exe "%~dp0_tool-runtime\Open Post to Video.vbs"
exit /b 0
'@

$stopCmd = @'
@echo off
cd /d "%~dp0"
echo Dang tat Post to Video...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_tool-runtime\stop-local-web.ps1"
exit /b 0
'@

$openVbs = @'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
runtimeRoot = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & runtimeRoot & "\start-local-web.ps1" & Chr(34)
shell.Run command, 0, False
Set fso = Nothing
Set shell = Nothing
'@

$guide = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "HUONG_DAN_TOOL.txt"), [System.Text.Encoding]::UTF8)

$manifest = [ordered]@{
  appName = "Post to Video"
  builtAt = (Get-Date).ToString("o")
  buildMode = "local-web-bundle"
  runtimeRoot = "_tool-runtime"
  nodeExecutable = "_tool-runtime/node.exe"
  browserPriority = @("chrome", "msedge")
  browserRequirement = "Google Chrome or Microsoft Edge must be installed"
  iconFile = "_tool-runtime/image9.ico"
  openScript = "OPEN TOOL.cmd"
  stopScript = "STOP TOOL.cmd"
  serverEntry = "_tool-runtime/server-dist/index.mjs"
  webEntry = "_tool-runtime/web-dist/index.html"
  version = $ReleaseLabel
  zipFile = [System.IO.Path]::GetFileName($zipPath)
  releaseLabel = $ReleaseLabel
}

Set-Content -LiteralPath (Join-Path $runtimeBundleRoot "start-local-web.ps1") -Value $startScript -Encoding UTF8
Set-Content -LiteralPath (Join-Path $runtimeBundleRoot "stop-local-web.ps1") -Value $stopScript -Encoding UTF8
Set-Content -LiteralPath (Join-Path $bundleRoot "OPEN TOOL.cmd") -Value $startCmd -Encoding ASCII
Set-Content -LiteralPath (Join-Path $bundleRoot "STOP TOOL.cmd") -Value $stopCmd -Encoding ASCII
Set-Content -LiteralPath (Join-Path $runtimeBundleRoot "Open Post to Video.vbs") -Value $openVbs -Encoding ASCII
Set-Content -LiteralPath (Join-Path $bundleRoot "HUONG_DAN_TOOL.txt") -Value $guide -Encoding UTF8
Set-Content -LiteralPath (Join-Path $runtimeBundleRoot "build-manifest.json") -Value (($manifest | ConvertTo-Json -Depth 4)) -Encoding UTF8

if (Get-Command attrib.exe -ErrorAction SilentlyContinue) {
  & attrib.exe +h (Join-Path $bundleRoot "_tool-runtime") 2>$null | Out-Null
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

if (Test-Path $zipWorkPath) {
  Remove-Item -LiteralPath $zipWorkPath -Force
}

Write-Step "Creating local web zip archive"
New-PortableZipArchive `
  -SourceDirectory $bundleRoot `
  -DestinationPath $zipWorkPath `
  -TopLevelName "Tool Crawl to Video"

Write-Step "Validating local web zip archive"
$archiveEntries = @(& tar.exe -tf $zipWorkPath)
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $zipWorkPath -Force -ErrorAction SilentlyContinue
  throw "Local web zip archive validation failed"
}
$requiredArchiveEntries = @(
  "Tool Crawl to Video/OPEN TOOL.cmd",
  "Tool Crawl to Video/STOP TOOL.cmd",
  "Tool Crawl to Video/_tool-runtime/portable-updater.ps1",
  "Tool Crawl to Video/_tool-runtime/node.exe",
  "Tool Crawl to Video/_tool-runtime/server-dist/index.mjs",
  "Tool Crawl to Video/_tool-runtime/web-dist/index.html",
  "Tool Crawl to Video/_tool-runtime/vendor/ffmpeg/bin/ffmpeg.exe",
  "Tool Crawl to Video/_tool-runtime/vendor/ffmpeg/bin/ffprobe.exe"
)
foreach ($requiredEntry in $requiredArchiveEntries) {
  if ($archiveEntries -notcontains $requiredEntry) {
    Remove-Item -LiteralPath $zipWorkPath -Force -ErrorAction SilentlyContinue
    throw "Local web zip archive is missing required entry: $requiredEntry"
  }
}
$forbiddenBrowserEntry = $archiveEntries |
  Where-Object {
    $_ -match "(^|/)(ms-playwright|chromium_headless_shell-[^/]+|chromium-[0-9]+)(/|$)"
  } |
  Select-Object -First 1
if ($forbiddenBrowserEntry) {
  Remove-Item -LiteralPath $zipWorkPath -Force -ErrorAction SilentlyContinue
  throw "Portable archive unexpectedly contains Playwright browser payload: $forbiddenBrowserEntry"
}

Move-Item -LiteralPath $zipWorkPath -Destination $zipPath

Write-Step ("Local web handoff folder ready at {0}" -f $bundleRoot)
Write-Step ("Local web handoff zip ready at {0}" -f $zipPath)
