$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$junction = Join-Path $env:USERPROFILE "listok-build"
$androidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$javaHome = "C:\Program Files\Android\Android Studio\jbr"

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
if (-not $env:CAPACITOR_SERVER_URL) {
  $env:CAPACITOR_SERVER_URL = "http://10.10.40.165:3000"
}

Push-Location $projectRoot
try {
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $junction) {
  $item = Get-Item -LiteralPath $junction -Force
  if ($item.LinkType -ne "Junction" -or $item.Target -notcontains $projectRoot) {
    throw "Build path $junction exists and does not point to this project."
  }
} else {
  New-Item -ItemType Junction -Path $junction -Target $projectRoot | Out-Null
}

Push-Location (Join-Path $junction "android")
try {
  & .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { throw "Android build failed." }
} finally {
  Pop-Location
}

$sourceApk = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$outputDir = Join-Path $projectRoot "output"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Copy-Item -LiteralPath $sourceApk -Destination (Join-Path $outputDir "Listok-debug.apk") -Force
Write-Output (Join-Path $outputDir "Listok-debug.apk")
