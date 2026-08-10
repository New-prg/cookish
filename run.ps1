# Run Cookish on Android using the Android Studio toolchain.
# Auto-installs missing SDK packages / cmdline-tools, creates and boots an
# emulator when no device is present, then builds, installs, and launches.
#
# Usage (prefer .\run.cmd if ExecutionPolicy blocks .ps1):
#   .\run.cmd                         # USB phone if connected, else emulator (default)
#   .\run.cmd -UsbOrEmulator          # same as default, explicit
#   .\run.cmd -Usb                    # alias of -UsbOrEmulator
#   .\run.cmd -Emulator               # force emulator (ignore phone)
#   .\run.cmd -PhysicalOnly           # USB phone required (fail if missing)
#   .\run.cmd -Avd NAME               # use/create this AVD
#   .\run.cmd -SkipBuild              # reinstall existing debug APK only
#   .\run.cmd -SkipTests              # skip Node unit tests
#   .\run.cmd -SkipDeps               # do not install npm/SDK packages
#   .\run.cmd -Serial DEVICE_ID
#   .\run.cmd -OpenStudio
#   powershell -ExecutionPolicy Bypass -File .\run.ps1 -Usb

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipTests,
  [switch]$SkipDeps,
  [switch]$OpenStudio,
  [switch]$NoDevice,
  [switch]$Emulator,
  [switch]$PhysicalOnly,
  [Alias("Usb")]
  [switch]$UsbOrEmulator,
  [string]$Serial,
  [string]$Avd
)

$ErrorActionPreference = "Stop"

$modeCount = 0
if ($Emulator) { $modeCount++ }
if ($PhysicalOnly) { $modeCount++ }
if ($UsbOrEmulator) { $modeCount++ }
if ($modeCount -gt 1) {
  throw "Use only one device mode: -UsbOrEmulator (or -Usb), -Emulator, or -PhysicalOnly."
}

$projectRoot = $PSScriptRoot
$packageName = "ru.listok.purchases"
$activity = "ru.listok.purchases/.MainActivity"
$apkSource = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$apkOutput = Join-Path $projectRoot "output\Cookish-debug.apk"
$emulatorLog = Join-Path $projectRoot "output\emulator.log"
$avdName = if ($Avd) { $Avd } elseif ($env:COOKISH_AVD) { $env:COOKISH_AVD } else { "Cookish_Pixel" }

. (Join-Path $projectRoot "scripts\android-env.ps1")

function Invoke-Adb {
  param([Parameter(Mandatory = $true)][string[]]$AdbArgs)
  $allArgs = @()
  if ($script:Serial) {
    $allArgs += @("-s", $script:Serial)
  }
  $allArgs += $AdbArgs
  & $script:env.AdbPath @allArgs
  if ($LASTEXITCODE -ne 0) {
    throw "adb failed: adb $($allArgs -join ' ') (exit $LASTEXITCODE)"
  }
}

# --- toolchain ---
Write-CookishStep "Detecting Android Studio toolchain"
$script:env = Initialize-CookishAndroidEnv -ProjectRoot $projectRoot
Write-Host "  Studio : $($script:env.StudioHome)"
Write-Host "  JAVA   : $($script:env.JavaHome)"
Write-Host "  SDK    : $($script:env.SdkPath)"

$buildRoot = Get-CookishBuildRoot -ProjectRoot $projectRoot
Write-Host "  Build  : $buildRoot"

# --- npm + SDK deps ---
if (-not $SkipDeps) {
  Ensure-NodeDependencies -ProjectRoot $projectRoot
  $script:env = Ensure-AndroidSdkDependencies -EnvInfo $script:env -CompileSdk "36" -BuildTools "36.0.0"
} else {
  Write-Host "  SkipDeps: not downloading npm/SDK packages"
  $script:env = Refresh-CookishAndroidEnvTools -EnvInfo $script:env
  if (-not $script:env.AdbPath) {
    throw "adb not found. Re-run without -SkipDeps (needs network/VPN for SDK install)."
  }
  if (-not $script:env.EmulatorPath -and -not $PhysicalOnly) {
    throw "emulator.exe not found. Re-run without -SkipDeps (or connect a USB phone with -PhysicalOnly)."
  }
  $script:env | Add-Member -NotePropertyName SystemImagePackage -NotePropertyValue (
    Find-InstalledSystemImagePackage -SdkPath $script:env.SdkPath
  ) -Force
}

Write-Host "  adb    : $($script:env.AdbPath)"
Write-Host "  emu    : $($script:env.EmulatorPath)"
if ($script:env.SystemImagePackage) {
  Write-Host "  image  : $($script:env.SystemImagePackage)"
}

# --- optional Studio ---
if ($OpenStudio) {
  if (-not $script:env.StudioExe) {
    throw "Android Studio executable not found (studio64.exe). Set ANDROID_STUDIO_HOME."
  }
  $androidModule = Join-Path $buildRoot "android"
  Write-CookishStep "Opening Android module in Android Studio"
  Write-Host "  $androidModule"
  Start-Process -FilePath $script:env.StudioExe -ArgumentList @($androidModule)
  if ($NoDevice) {
    Write-Host ""
    Write-Host "Android Studio launched. Device Manager / Run can use AVD '$avdName'." -ForegroundColor Green
    exit 0
  }
}

if ($NoDevice -and -not $OpenStudio) {
  throw "-NoDevice is only valid together with -OpenStudio"
}

# --- unit tests ---
if (-not $SkipTests -and -not $SkipBuild) {
  Write-CookishStep "Running unit tests"
  Push-Location $projectRoot
  try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
      throw "Unit tests failed."
    }
  } finally {
    Pop-Location
  }
}

# --- device / emulator ---
$deviceMode = if ($Emulator) {
  "emulator-only"
} elseif ($PhysicalOnly) {
  "usb-only"
} else {
  "usb-or-emulator"
}

Write-CookishStep "Resolving Android device ($deviceMode)"
if ($deviceMode -eq "usb-or-emulator") {
  Write-Host "  Policy: use USB phone if ready, otherwise start emulator"
}

$script:Serial = Resolve-CookishTargetDevice `
  -EnvInfo $script:env `
  -Serial $Serial `
  -AvdName $avdName `
  -PreferEmulator:$Emulator `
  -PhysicalOnly:$PhysicalOnly `
  -UsbOrEmulator:($deviceMode -eq "usb-or-emulator") `
  -EmulatorLogPath $emulatorLog

$env:ANDROID_SERIAL = $script:Serial
Write-Host "  Target: $script:Serial" -ForegroundColor Green

# --- build + install ---
if (-not $SkipBuild) {
  Write-CookishStep "Capacitor sync (web assets -> android)"
  Push-Location $projectRoot
  try {
    & npx.cmd cap sync android
    if ($LASTEXITCODE -ne 0) {
      throw "Capacitor sync failed."
    }
  } finally {
    Pop-Location
  }

  Write-AndroidLocalProperties -ProjectRoot $projectRoot -SdkPath $script:env.SdkPath

  Write-CookishStep "Gradle installDebug"
  $androidDir = Join-Path $buildRoot "android"
  Push-Location $androidDir
  try {
    & .\gradlew.bat installDebug
    if ($LASTEXITCODE -ne 0) {
      throw "Gradle installDebug failed."
    }
  } finally {
    Pop-Location
  }

  if (Test-Path -LiteralPath $apkSource) {
    $outputDir = Join-Path $projectRoot "output"
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    Copy-Item -LiteralPath $apkSource -Destination $apkOutput -Force
  }
} else {
  Write-CookishStep "Skip build - installing existing debug APK"
  $apk = $apkOutput
  if (-not (Test-Path -LiteralPath $apk)) {
    $apk = $apkSource
  }
  if (-not (Test-Path -LiteralPath $apk)) {
    throw "APK not found. Run without -SkipBuild first."
  }
  Invoke-Adb -AdbArgs @("install", "-r", $apk)
}

# --- launch ---
Write-CookishStep "Launching Cookish"
Invoke-Adb -AdbArgs @("shell", "am", "start", "-n", $activity)

Write-Host ""
Write-Host "Done. Cookish ($packageName) is running on $script:Serial" -ForegroundColor Green
if (Test-Path -LiteralPath $apkOutput) {
  Write-Host "APK copy: $apkOutput"
}
Write-Host "Device mode: $deviceMode  |  AVD: $avdName  |  Emulator log: $emulatorLog"
