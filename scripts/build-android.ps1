$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "android-env.ps1")

$projectRoot = Get-CookishProjectRoot -FromScriptRoot $PSScriptRoot
$envInfo = Initialize-CookishAndroidEnv -ProjectRoot $projectRoot
$junction = Get-CookishBuildRoot -ProjectRoot $projectRoot

Write-Host "JAVA_HOME=$($envInfo.JavaHome)"
Write-Host "ANDROID_HOME=$($envInfo.SdkPath)"
Write-Host "Build root=$junction"

Push-Location $projectRoot
try {
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }
} finally {
  Pop-Location
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
Copy-Item -LiteralPath $sourceApk -Destination (Join-Path $outputDir "Cookish-debug.apk") -Force
Write-Output (Join-Path $outputDir "Cookish-debug.apk")
