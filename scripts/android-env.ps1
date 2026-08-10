# Shared Android Studio / SDK / emulator helpers for Cookish.
# Dot-source: . "$PSScriptRoot\android-env.ps1"

$script:CookishDefaultAvdName = "Cookish_Pixel"
$script:CmdlineToolsZipUrl = "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip"

function Get-CookishProjectRoot {
  param([string]$FromScriptRoot)
  return (Resolve-Path (Join-Path $FromScriptRoot "..")).Path
}

function Write-CookishStep([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Normalize-FsPath([string]$PathValue) {
  if (-not $PathValue) { return $null }
  $normalized = $PathValue -replace '/', '\'
  try {
    return [System.IO.Path]::GetFullPath($normalized)
  } catch {
    return $normalized
  }
}

function Get-AndroidStudioHome {
  $candidates = @(
    $env:ANDROID_STUDIO_HOME,
    "C:\Program Files\Android\Android Studio",
    "C:\Program Files\Android\Android Studio1",
    (Join-Path $env:LOCALAPPDATA "Programs\Android\Android Studio"),
    (Join-Path $env:ProgramFiles "Android\Android Studio")
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    $studioExe = Join-Path $candidate "bin\studio64.exe"
    $jbrJava = Join-Path $candidate "jbr\bin\java.exe"
    if ((Test-Path -LiteralPath $studioExe) -or (Test-Path -LiteralPath $jbrJava)) {
      return $candidate
    }
  }
  return $null
}

function Get-AndroidStudioJavaHome {
  param([string]$StudioHome)

  if ($StudioHome) {
    $jbr = Join-Path $StudioHome "jbr"
    if (Test-Path -LiteralPath (Join-Path $jbr "bin\java.exe")) {
      return $jbr
    }
  }

  if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
    return $env:JAVA_HOME
  }

  return $null
}

function Get-AndroidSdkPath {
  param([string]$ProjectRoot)

  $localProps = Join-Path $ProjectRoot "android\local.properties"
  if (Test-Path -LiteralPath $localProps) {
    foreach ($line in Get-Content -LiteralPath $localProps) {
      if ($line -match '^\s*sdk\.dir\s*=\s*(.+)\s*$') {
        $sdk = Normalize-FsPath ($Matches[1].Trim() -replace '\\\\', '\')
        if ($sdk -and (Test-Path -LiteralPath $sdk)) {
          return $sdk
        }
      }
    }
  }

  $candidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
    (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk")
  ) | Where-Object { $_ }

  foreach ($sdk in $candidates) {
    $full = Normalize-FsPath $sdk
    if ($full -and (Test-Path -LiteralPath $full)) {
      return $full
    }
  }
  return $null
}

function Write-AndroidLocalProperties {
  param(
    [string]$ProjectRoot,
    [string]$SdkPath
  )
  $androidDir = Join-Path $ProjectRoot "android"
  if (-not (Test-Path -LiteralPath $androidDir)) {
    throw "Android project not found: $androidDir"
  }
  $sdkDir = ((Normalize-FsPath $SdkPath) -replace '\\', '/').TrimEnd('/')
  $content = "sdk.dir=$sdkDir`r`n"
  $target = Join-Path $androidDir "local.properties"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

function Get-AdbPath {
  param([string]$SdkPath)

  $candidates = @()
  if ($SdkPath) {
    $candidates += (Join-Path $SdkPath "platform-tools\adb.exe")
  }
  if ($env:ANDROID_HOME) {
    $candidates += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe")
  }
  if ($env:ANDROID_SDK_ROOT) {
    $candidates += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe")
  }

  foreach ($path in $candidates) {
    $full = Normalize-FsPath $path
    if ($full -and (Test-Path -LiteralPath $full)) {
      return $full
    }
  }

  $fromPath = Get-Command adb -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }
  return $null
}

function Get-EmulatorPath {
  param([string]$SdkPath)
  $path = Join-Path $SdkPath "emulator\emulator.exe"
  if (Test-Path -LiteralPath $path) { return $path }
  return $null
}

function Get-SdkManagerPath {
  param([string]$SdkPath)

  $roots = @(
    (Join-Path $SdkPath "cmdline-tools\latest\bin\sdkmanager.bat"),
    (Join-Path $SdkPath "cmdline-tools\bin\sdkmanager.bat")
  )
  $versioned = Get-ChildItem -LiteralPath (Join-Path $SdkPath "cmdline-tools") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "latest" -and $_.Name -ne "bin" } |
    ForEach-Object { Join-Path $_.FullName "bin\sdkmanager.bat" }
  $roots = @($roots) + @($versioned)

  foreach ($path in $roots) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      return $path
    }
  }
  return $null
}

function Get-AvdManagerPath {
  param([string]$SdkPath)

  $sdkManager = Get-SdkManagerPath -SdkPath $SdkPath
  if ($sdkManager) {
    $avd = Join-Path (Split-Path $sdkManager -Parent) "avdmanager.bat"
    if (Test-Path -LiteralPath $avd) {
      return $avd
    }
  }
  return $null
}

function Initialize-CookishAndroidEnv {
  param([string]$ProjectRoot)

  $studioHome = Get-AndroidStudioHome
  $javaHome = Get-AndroidStudioJavaHome -StudioHome $studioHome
  $sdkPath = Get-AndroidSdkPath -ProjectRoot $ProjectRoot

  if (-not $javaHome) {
    throw "JDK not found. Install Android Studio (bundled JBR) or set JAVA_HOME. Expected: C:\Program Files\Android\Android Studio\jbr"
  }

  if (-not $sdkPath) {
    $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    Write-Warning "Android SDK not found; creating $defaultSdk"
    New-Item -ItemType Directory -Path $defaultSdk -Force | Out-Null
    $sdkPath = $defaultSdk
  }

  $sdkPath = Normalize-FsPath $sdkPath
  $env:JAVA_HOME = $javaHome
  $env:ANDROID_HOME = $sdkPath
  $env:ANDROID_SDK_ROOT = $sdkPath

  # sdkmanager/avdmanager on Windows expect these on PATH sometimes
  $platformTools = Join-Path $sdkPath "platform-tools"
  $emulatorDir = Join-Path $sdkPath "emulator"
  $env:Path = "$platformTools;$emulatorDir;$env:Path"

  Write-AndroidLocalProperties -ProjectRoot $ProjectRoot -SdkPath $sdkPath

  $studioExe = $null
  if ($studioHome) {
    $candidate = Join-Path $studioHome "bin\studio64.exe"
    if (Test-Path -LiteralPath $candidate) {
      $studioExe = $candidate
    }
  }

  return [pscustomobject]@{
    StudioHome     = $studioHome
    StudioExe      = $studioExe
    JavaHome       = $javaHome
    SdkPath        = $sdkPath
    AdbPath        = (Get-AdbPath -SdkPath $sdkPath)
    EmulatorPath   = (Get-EmulatorPath -SdkPath $sdkPath)
    SdkManagerPath = (Get-SdkManagerPath -SdkPath $sdkPath)
    AvdManagerPath = (Get-AvdManagerPath -SdkPath $sdkPath)
  }
}

function Refresh-CookishAndroidEnvTools {
  param($EnvInfo)
  $EnvInfo.AdbPath = Get-AdbPath -SdkPath $EnvInfo.SdkPath
  $EnvInfo.EmulatorPath = Get-EmulatorPath -SdkPath $EnvInfo.SdkPath
  $EnvInfo.SdkManagerPath = Get-SdkManagerPath -SdkPath $EnvInfo.SdkPath
  $EnvInfo.AvdManagerPath = Get-AvdManagerPath -SdkPath $EnvInfo.SdkPath
  return $EnvInfo
}

function Get-CookishBuildRoot {
  param([string]$ProjectRoot)

  $junction = Join-Path $env:USERPROFILE "cookish-build"
  $projectFull = [System.IO.Path]::GetFullPath($ProjectRoot)

  $needsCreate = $true
  if (Test-Path -LiteralPath $junction) {
    $item = Get-Item -LiteralPath $junction -Force
    $rawTarget = $null
    if ($item.LinkType -eq "Junction" -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      if ($item.Target -is [array]) {
        $rawTarget = $item.Target[0]
      } else {
        $rawTarget = $item.Target
      }
    }

    if ($rawTarget) {
      try {
        $targetFull = [System.IO.Path]::GetFullPath($rawTarget)
      } catch {
        $targetFull = $rawTarget
      }
      if ($targetFull -eq $projectFull) {
        $needsCreate = $false
      } else {
        Write-Warning "Re-pointing build junction $junction -> $projectFull (was: $rawTarget)"
        cmd /c rmdir "$junction" | Out-Null
      }
    } else {
      if ($item.PSIsContainer) {
        throw "Path $junction exists and is not a junction. Move/rename it, then re-run."
      }
      Remove-Item -LiteralPath $junction -Force
    }
  }

  if ($needsCreate) {
    New-Item -ItemType Junction -Path $junction -Target $projectFull | Out-Null
  }

  return $junction
}

function Ensure-NodeDependencies {
  param([string]$ProjectRoot)

  $nodeModules = Join-Path $ProjectRoot "node_modules"
  $lockFile = Join-Path $ProjectRoot "package-lock.json"
  if ((Test-Path -LiteralPath $nodeModules) -and (Test-Path -LiteralPath (Join-Path $nodeModules "@capacitor\cli"))) {
    return
  }

  Write-CookishStep "Installing npm dependencies"
  Push-Location $ProjectRoot
  try {
    if (Test-Path -LiteralPath $lockFile) {
      & npm.cmd ci
    } else {
      & npm.cmd install
    }
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed."
    }
  } finally {
    Pop-Location
  }
}

function Ensure-AndroidCmdlineTools {
  param($EnvInfo)

  $sdkPath = $EnvInfo.SdkPath
  $existing = Get-SdkManagerPath -SdkPath $sdkPath
  if ($existing) {
    return $existing
  }

  Write-CookishStep "Downloading Android command-line tools"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $tmpRoot = Join-Path $env:TEMP ("cookish-cmdline-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tmpRoot "commandlinetools.zip"
  $extractDir = Join-Path $tmpRoot "extract"
  New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

  try {
    Write-Host "  URL: $($script:CmdlineToolsZipUrl)"
    Invoke-WebRequest -Uri $script:CmdlineToolsZipUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

    $binDir = Get-ChildItem -Path $extractDir -Recurse -Directory -Filter "bin" -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "sdkmanager.bat") } |
      Select-Object -First 1
    if (-not $binDir) {
      throw "sdkmanager.bat not found inside downloaded command-line tools archive."
    }

    $sourceRoot = Split-Path $binDir.FullName -Parent
    $targetRoot = Join-Path $sdkPath "cmdline-tools\latest"
    if (Test-Path -LiteralPath $targetRoot) {
      Remove-Item -LiteralPath $targetRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Split-Path $targetRoot -Parent) -Force | Out-Null
    Move-Item -LiteralPath $sourceRoot -Destination $targetRoot
  } finally {
    if (Test-Path -LiteralPath $tmpRoot) {
      Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  $sdkManager = Get-SdkManagerPath -SdkPath $sdkPath
  if (-not $sdkManager) {
    throw "Failed to install cmdline-tools into $sdkPath"
  }
  Write-Host "  sdkmanager: $sdkManager"
  return $sdkManager
}

function Invoke-NativeBatch {
  param(
    [string]$BatPath,
    [string[]]$BatArgs,
    [string]$StdinText,
    [hashtable]$ExtraEnv
  )

  $env:JAVA_HOME = $ExtraEnv["JAVA_HOME"]
  $env:ANDROID_HOME = $ExtraEnv["ANDROID_HOME"]
  $env:ANDROID_SDK_ROOT = $ExtraEnv["ANDROID_SDK_ROOT"]

  $argLine = ($BatArgs | ForEach-Object {
      if ($_ -match '[\s;]') { '"{0}"' -f ($_ -replace '"', '\"') } else { $_ }
    }) -join ' '

  # .bat files need cmd.exe when UseShellExecute is false
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "$env:ComSpec"
  $psi.Arguments = "/c `"`"$BatPath`" $argLine`""
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = Split-Path $BatPath -Parent

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  if ($StdinText) {
    $proc.StandardInput.Write($StdinText)
  }
  $proc.StandardInput.Close()
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $proc.ExitCode
    StdOut   = $stdout
    StdErr   = $stderr
  }
}

function Invoke-SdkManager {
  param(
    $EnvInfo,
    [Parameter(Mandatory = $true)][string[]]$SdkArgs
  )

  $sdkManager = $EnvInfo.SdkManagerPath
  if (-not $sdkManager) {
    $sdkManager = Ensure-AndroidCmdlineTools -EnvInfo $EnvInfo
    $EnvInfo.SdkManagerPath = $sdkManager
    $EnvInfo.AvdManagerPath = Get-AvdManagerPath -SdkPath $EnvInfo.SdkPath
  }

  $result = Invoke-NativeBatch -BatPath $sdkManager -BatArgs $SdkArgs -StdinText ("y`r`n" * 120) -ExtraEnv @{
    JAVA_HOME        = $EnvInfo.JavaHome
    ANDROID_HOME     = $EnvInfo.SdkPath
    ANDROID_SDK_ROOT = $EnvInfo.SdkPath
  }

  if ($result.StdOut) { Write-Host $result.StdOut }
  if ($result.StdErr) { Write-Host $result.StdErr }

  if ($result.ExitCode -ne 0) {
    throw "sdkmanager failed (exit $($result.ExitCode)): $($SdkArgs -join ' ')"
  }
}

function Test-AndroidSdkPackagePath {
  param(
    [string]$SdkPath,
    [string]$PackageId
  )

  # package id like platforms;android-36 or system-images;android-36;google_apis;x86_64
  $rel = ($PackageId -replace ';', '\')
  $full = Join-Path $SdkPath $rel
  if (Test-Path -LiteralPath $full) {
    return $true
  }

  # build-tools and platform-tools are flat
  switch -Regex ($PackageId) {
    '^platform-tools$' { return Test-Path -LiteralPath (Join-Path $SdkPath "platform-tools\adb.exe") }
    '^emulator$' { return Test-Path -LiteralPath (Join-Path $SdkPath "emulator\emulator.exe") }
    '^build-tools;(.+)$' {
      return Test-Path -LiteralPath (Join-Path $SdkPath ("build-tools\" + $Matches[1]))
    }
  }
  return $false
}

function Find-InstalledSystemImagePackage {
  param([string]$SdkPath)

  $root = Join-Path $SdkPath "system-images"
  if (-not (Test-Path -LiteralPath $root)) {
    return $null
  }

  # Prefer Google Play images (needed for Google Sign-In), then google_apis, any x86_64.
  $candidates = @()
  Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $apiDir = $_
    Get-ChildItem -LiteralPath $apiDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $tagDir = $_
      Get-ChildItem -LiteralPath $tagDir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $abiDir = $_
        $packageId = "system-images;{0};{1};{2}" -f $apiDir.Name, $tagDir.Name, $abiDir.Name
        $score = 0
        if ($tagDir.Name -match 'playstore') { $score += 100 }
        elseif ($tagDir.Name -match 'google_apis') { $score += 50 }
        if ($abiDir.Name -eq 'x86_64') { $score += 20 }
        elseif ($abiDir.Name -eq 'x86') { $score += 10 }
        # Prefer API close to compileSdk 36
        if ($apiDir.Name -match 'android-(\d+)') {
          $api = [int]$Matches[1]
          $score += (50 - [Math]::Abs($api - 36))
        }
        $candidates += [pscustomobject]@{ Id = $packageId; Score = $score }
      }
    }
  }

  if ($candidates.Count -eq 0) {
    return $null
  }
  return ($candidates | Sort-Object Score -Descending | Select-Object -First 1).Id
}

function Ensure-AndroidLicenses {
  param($EnvInfo)

  $licensesDir = Join-Path $EnvInfo.SdkPath "licenses"
  New-Item -ItemType Directory -Path $licensesDir -Force | Out-Null

  # Known license hashes accepted by the Android SDK tooling.
  $licenseFiles = @{
    "android-sdk-license"           = @("24333f8a63b6825ea9c5514f83c2829b004d1fee", "d56f5187479451eabf01fb78af6dfcb131a6481e", "24333f8a63b6825ea9c5514f83c2829b004d1fee")
    "android-sdk-preview-license"   = @("84831b9409646a918e30573bab4c9c91346d8abd")
    "google-gdk-license"            = @("33b6a2b64607f11b759f320ef9dff4ae5c47d97a")
    "android-googletv-license"      = @("601085b94cd77f0b54ff86406957099ebe79c4d6")
    "android-sdk-arm-dbt-license"   = @("859f317696f67ef3d7f30a50a5560e7834b43992")
    "mips-android-sysimage-license" = @("e9acab5b5fbb560a72cfaecce8946896ff6aab9d")
    "intel-android-extra-license"   = @("d975f751698a77b662f1254ddbeed3901e976f5a")
  }

  foreach ($name in $licenseFiles.Keys) {
    $path = Join-Path $licensesDir $name
    $body = ($licenseFiles[$name] -join "`r`n") + "`r`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($path, $body, $utf8NoBom)
  }

  # Also run sdkmanager --licenses when available (best effort).
  try {
    Invoke-SdkManager -EnvInfo $EnvInfo -SdkArgs @("--licenses", "--sdk_root=$($EnvInfo.SdkPath)")
  } catch {
    Write-Warning "sdkmanager --licenses reported an issue (continuing with pre-seeded licenses): $($_.Exception.Message)"
  }
}

function Ensure-AndroidSdkDependencies {
  param(
    $EnvInfo,
    [string]$CompileSdk = "36",
    [string]$BuildTools = "36.0.0"
  )

  Write-CookishStep "Ensuring Android SDK packages"
  Ensure-AndroidCmdlineTools -EnvInfo $EnvInfo | Out-Null
  $EnvInfo = Refresh-CookishAndroidEnvTools -EnvInfo $EnvInfo
  Ensure-AndroidLicenses -EnvInfo $EnvInfo

  $required = @(
    "platform-tools",
    "emulator",
    "platforms;android-$CompileSdk",
    "build-tools;$BuildTools"
  )

  $systemImage = Find-InstalledSystemImagePackage -SdkPath $EnvInfo.SdkPath
  if (-not $systemImage) {
    # Google Play image for OAuth / Play services; x86_64 for desktop emulator.
    $systemImage = "system-images;android-$CompileSdk;google_apis_playstore;x86_64"
    $required += $systemImage
  } else {
    Write-Host "  Reusing system image: $systemImage"
  }

  $missing = @()
  foreach ($pkg in $required) {
    if (-not (Test-AndroidSdkPackagePath -SdkPath $EnvInfo.SdkPath -PackageId $pkg)) {
      $missing += $pkg
    } else {
      Write-Host "  OK $pkg"
    }
  }

  if ($missing.Count -gt 0) {
    Write-Host "  Installing: $($missing -join ', ')"
    $sdkArgs = @("--sdk_root=$($EnvInfo.SdkPath)") + $missing
    Invoke-SdkManager -EnvInfo $EnvInfo -SdkArgs $sdkArgs
  }

  $EnvInfo = Refresh-CookishAndroidEnvTools -EnvInfo $EnvInfo
  if (-not $EnvInfo.AdbPath) {
    throw "adb still missing after SDK install."
  }
  if (-not $EnvInfo.EmulatorPath) {
    throw "emulator still missing after SDK install."
  }

  $EnvInfo | Add-Member -NotePropertyName SystemImagePackage -NotePropertyValue (
    Find-InstalledSystemImagePackage -SdkPath $EnvInfo.SdkPath
  ) -Force

  return $EnvInfo
}

function Get-AvdNames {
  param($EnvInfo)

  if (-not $EnvInfo.EmulatorPath) {
    return @()
  }
  $raw = & $EnvInfo.EmulatorPath -list-avds 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }
  return @($raw | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
}

function Set-AvdConfigValues {
  param(
    [string]$AvdName,
    [hashtable]$Values
  )

  $configPath = Join-Path $env:USERPROFILE (".android\avd\{0}.avd\config.ini" -f $AvdName)
  if (-not (Test-Path -LiteralPath $configPath)) {
    Write-Warning "AVD config not found: $configPath"
    return
  }

  $lines = Get-Content -LiteralPath $configPath
  $keysDone = @{}
  $out = foreach ($line in $lines) {
    if ($line -match '^\s*([^=]+)=(.*)$') {
      $key = $Matches[1].Trim()
      if ($Values.ContainsKey($key)) {
        $keysDone[$key] = $true
        "{0}={1}" -f $key, $Values[$key]
        continue
      }
    }
    $line
  }
  foreach ($key in $Values.Keys) {
    if (-not $keysDone.ContainsKey($key)) {
      $out += "{0}={1}" -f $key, $Values[$key]
    }
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllLines($configPath, $out, $utf8NoBom)
}

function Ensure-CookishAvd {
  param(
    $EnvInfo,
    [string]$AvdName = $(if ($env:COOKISH_AVD) { $env:COOKISH_AVD } else { $script:CookishDefaultAvdName })
  )

  $existing = Get-AvdNames -EnvInfo $EnvInfo
  if ($existing -contains $AvdName) {
    Write-Host "  AVD ready: $AvdName"
    return $AvdName
  }

  if ($existing.Count -gt 0 -and $AvdName -eq $script:CookishDefaultAvdName) {
    # Prefer any existing AVD rather than forcing a new download/create when default name missing.
    # Still create our managed AVD for a predictable setup.
  }

  $systemImage = $EnvInfo.SystemImagePackage
  if (-not $systemImage) {
    $systemImage = Find-InstalledSystemImagePackage -SdkPath $EnvInfo.SdkPath
  }
  if (-not $systemImage) {
    throw "No system image installed. Re-run with network so SDK packages can be downloaded."
  }

  $avdManager = $EnvInfo.AvdManagerPath
  if (-not $avdManager) {
    throw "avdmanager not found. cmdline-tools install may have failed."
  }

  Write-CookishStep "Creating AVD $AvdName"
  Write-Host "  Image : $systemImage"
  Write-Host "  Device: pixel_6"

  $env:JAVA_HOME = $EnvInfo.JavaHome
  $env:ANDROID_HOME = $EnvInfo.SdkPath
  $env:ANDROID_SDK_ROOT = $EnvInfo.SdkPath

  # avdmanager prompts "Do you wish to create a custom hardware profile?" -> no
  $createArgs = @(
    "create", "avd",
    "--force",
    "--name", $AvdName,
    "--package", $systemImage,
    "--device", "pixel_6"
  )

  $result = Invoke-NativeBatch -BatPath $avdManager -BatArgs $createArgs -StdinText "no`r`n" -ExtraEnv @{
    JAVA_HOME        = $EnvInfo.JavaHome
    ANDROID_HOME     = $EnvInfo.SdkPath
    ANDROID_SDK_ROOT = $EnvInfo.SdkPath
  }
  if ($result.StdOut) { Write-Host $result.StdOut }
  if ($result.StdErr) { Write-Host $result.StdErr }
  if ($result.ExitCode -ne 0) {
    throw "avdmanager create avd failed (exit $($result.ExitCode))"
  }

  Set-AvdConfigValues -AvdName $AvdName -Values @{
    "hw.keyboard"              = "yes"
    "hw.mainKeys"              = "no"
    "hw.ramSize"               = "2048"
    "vm.heapSize"              = "256"
    "disk.dataPartition.size"  = "4G"
    "hw.gpu.enabled"           = "yes"
    "hw.gpu.mode"              = "auto"
    "showDeviceFrame"          = "yes"
    "fastboot.forceColdBoot"   = "no"
    "hw.camera.back"           = "virtualscene"
    "hw.camera.front"          = "emulated"
  }

  Write-Host "  Created AVD $AvdName"
  return $AvdName
}

function Get-AdbDevices {
  param($EnvInfo)

  if (-not $EnvInfo.AdbPath) {
    return @()
  }
  $raw = & $EnvInfo.AdbPath devices
  $devices = @()
  foreach ($line in $raw) {
    if ($line -match '^\s*$' -or $line -match '^List of devices') {
      continue
    }
    if ($line -match '^(\S+)\s+(\S+)') {
      $serial = $Matches[1]
      $state = $Matches[2]
      $devices += [pscustomobject]@{
        Serial    = $serial
        State     = $state
        IsEmulator = ($serial -like "emulator-*")
      }
    }
  }
  return $devices
}

function Wait-ForAdbDevice {
  param(
    $EnvInfo,
    [string]$Serial,
    [int]$TimeoutSec = 240
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Host "  Waiting for device $Serial (timeout ${TimeoutSec}s)..."

  do {
    if ($Serial) {
      & $EnvInfo.AdbPath -s $Serial wait-for-device 2>$null | Out-Null
    } else {
      & $EnvInfo.AdbPath wait-for-device 2>$null | Out-Null
    }

    $boot = ""
    try {
      if ($Serial) {
        $boot = (& $EnvInfo.AdbPath -s $Serial shell getprop sys.boot_completed 2>$null | Out-String).Trim()
      } else {
        $boot = (& $EnvInfo.AdbPath shell getprop sys.boot_completed 2>$null | Out-String).Trim()
      }
    } catch {
      $boot = ""
    }

    if ($boot -eq "1") {
      # Give system UI a moment after boot_completed.
      Start-Sleep -Seconds 2
      return
    }

    if ((Get-Date) -gt $deadline) {
      throw "Timed out waiting for Android boot_completed on $Serial"
    }
    Start-Sleep -Seconds 3
  } while ($true)
}

function Configure-EmulatorRuntime {
  param(
    $EnvInfo,
    [string]$Serial
  )

  Write-Host "  Applying emulator runtime settings..."
  $cmds = @(
    @("shell", "settings", "put", "global", "window_animation_scale", "0"),
    @("shell", "settings", "put", "global", "transition_animation_scale", "0"),
    @("shell", "settings", "put", "global", "animator_duration_scale", "0"),
    @("shell", "settings", "put", "system", "accelerometer_rotation", "0"),
    @("shell", "wm", "dismiss-keyguard"),
    @("shell", "input", "keyevent", "82")
  )
  foreach ($c in $cmds) {
    & $EnvInfo.AdbPath -s $Serial @c 2>$null | Out-Null
  }
}

function Start-CookishEmulator {
  param(
    $EnvInfo,
    [string]$AvdName,
    [string]$LogPath
  )

  if (-not $EnvInfo.EmulatorPath) {
    throw "emulator.exe not found."
  }

  # Already running?
  $running = @(Get-AdbDevices -EnvInfo $EnvInfo | Where-Object { $_.IsEmulator -and $_.State -eq "device" })
  if ($running.Count -gt 0) {
    Write-Host "  Emulator already running: $($running[0].Serial)"
    return $running[0].Serial
  }

  # Offline/booting emulator serials
  $booting = @(Get-AdbDevices -EnvInfo $EnvInfo | Where-Object { $_.IsEmulator })
  if ($booting.Count -eq 0) {
    Write-CookishStep "Starting emulator $AvdName"
    $logDir = Split-Path $LogPath -Parent
    if ($logDir) {
      New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $emuArgs = @(
      "-avd", $AvdName,
      "-netdelay", "none",
      "-netspeed", "full",
      "-gpu", "auto",
      "-no-boot-anim"
    )

    $stdout = $LogPath
    $stderr = [System.IO.Path]::ChangeExtension($LogPath, ".err.log")
    Start-Process -FilePath $EnvInfo.EmulatorPath -ArgumentList $emuArgs -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Normal | Out-Null
    Write-Host "  Log: $LogPath"
  } else {
    Write-Host "  Emulator is booting: $($booting[0].Serial)"
  }

  # Wait until any emulator appears in adb, then until boot completes.
  $deadline = (Get-Date).AddSeconds(300)
  $serial = $null
  do {
    $emu = @(Get-AdbDevices -EnvInfo $EnvInfo | Where-Object { $_.IsEmulator -and ($_.State -eq "device" -or $_.State -eq "offline") })
    if ($emu.Count -gt 0) {
      $serial = $emu[0].Serial
      break
    }
    if ((Get-Date) -gt $deadline) {
      throw "Emulator did not appear in adb. Check $LogPath"
    }
    Start-Sleep -Seconds 2
  } while ($true)

  Wait-ForAdbDevice -EnvInfo $EnvInfo -Serial $serial -TimeoutSec 300
  Configure-EmulatorRuntime -EnvInfo $EnvInfo -Serial $serial
  return $serial
}

function Resolve-CookishTargetDevice {
  param(
    $EnvInfo,
    [string]$Serial,
    [string]$AvdName,
    [switch]$PreferEmulator,
    [switch]$PhysicalOnly,
    [string]$EmulatorLogPath
  )

  $devices = @(Get-AdbDevices -EnvInfo $EnvInfo)
  $ready = @($devices | Where-Object { $_.State -eq "device" })
  $other = @($devices | Where-Object { $_.State -ne "device" })

  if ($other.Count -gt 0) {
    foreach ($d in $other) {
      Write-Host "  $($d.Serial)  [$($d.State)]" -ForegroundColor Yellow
    }
  }

  if ($Serial) {
    $match = $ready | Where-Object { $_.Serial -eq $Serial }
    if ($match) {
      return $Serial
    }
    # Wait if device is known but still booting
    $known = $devices | Where-Object { $_.Serial -eq $Serial }
    if ($known) {
      Wait-ForAdbDevice -EnvInfo $EnvInfo -Serial $Serial -TimeoutSec 240
      return $Serial
    }
    throw "Device '$Serial' not found. Connected: $(($devices | ForEach-Object { "$($_.Serial)($($_.State))" }) -join ', ')"
  }

  if ($PhysicalOnly) {
    $physical = @($ready | Where-Object { -not $_.IsEmulator })
    if ($physical.Count -eq 0) {
      throw "No physical device connected (-PhysicalOnly)."
    }
    if ($physical.Count -gt 1) {
      throw "Several physical devices: $(($physical | ForEach-Object Serial) -join ', '). Pass -Serial."
    }
    return $physical[0].Serial
  }

  if (-not $PreferEmulator) {
    $physical = @($ready | Where-Object { -not $_.IsEmulator })
    if ($physical.Count -eq 1) {
      Write-Host "  Using physical device $($physical[0].Serial)"
      return $physical[0].Serial
    }
    if ($physical.Count -gt 1) {
      throw "Several physical devices: $(($physical | ForEach-Object Serial) -join ', '). Pass -Serial or -Emulator."
    }
  }

  $readyEmu = @($ready | Where-Object { $_.IsEmulator })
  if ($readyEmu.Count -ge 1 -and -not $PreferEmulator) {
    return $readyEmu[0].Serial
  }
  if ($readyEmu.Count -ge 1 -and $PreferEmulator) {
    # Still fine to reuse running emulator
    Configure-EmulatorRuntime -EnvInfo $EnvInfo -Serial $readyEmu[0].Serial
    return $readyEmu[0].Serial
  }

  $avd = Ensure-CookishAvd -EnvInfo $EnvInfo -AvdName $AvdName
  return (Start-CookishEmulator -EnvInfo $EnvInfo -AvdName $avd -LogPath $EmulatorLogPath)
}
