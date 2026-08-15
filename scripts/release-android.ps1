[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Notes = "",
  [switch]$DryRun,
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"
$repository = "New-prg/cookish"
$workflow = "release-android.yml"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Program,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  $output = @(& $Program @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $details = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    throw "$FailureMessage$([Environment]::NewLine)$details"
  }
  return $output
}

function Normalize-Version {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value -notmatch '^v?([0-9]+)\.([0-9]+)\.([0-9]+)$') {
    throw "Version must use MAJOR.MINOR.PATCH, for example 5.4.0."
  }
  return "$($Matches[1]).$($Matches[2]).$($Matches[3])"
}

Push-Location $projectRoot
try {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required."
  }
  Invoke-CapturedCommand -Program "gh" -Arguments @("auth", "status") `
    -FailureMessage "GitHub CLI is not authenticated." | Out-Null

  $actualRepositoryOutput = @(Invoke-CapturedCommand -Program "gh" -Arguments @(
    "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"
  ) -FailureMessage "Could not identify the GitHub repository.")
  $actualRepository = $actualRepositoryOutput[-1].ToString().Trim()
  if ($actualRepository -ne $repository) {
    throw "Expected $repository, found $actualRepository."
  }

  $branchOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "branch", "--show-current"
  ) -FailureMessage "Could not read the current branch.")
  $branch = $branchOutput[-1].ToString().Trim()
  if ($branch -ne "master") {
    throw "Releases must run from master; current branch is $branch."
  }

  $trackedChanges = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "status", "--porcelain", "--untracked-files=no"
  ) -FailureMessage "Could not inspect tracked changes.")
  if ($trackedChanges.Count -gt 0) {
    throw "Tracked changes are not committed. Finish, test, commit, and push them before releasing."
  }

  $untrackedFiles = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "ls-files", "--others", "--exclude-standard"
  ) -FailureMessage "Could not inspect untracked files." | ForEach-Object {
    $_.ToString().Trim()
  } | Where-Object { $_ })
  $releaseRelevantUntracked = @($untrackedFiles | Where-Object {
    $_ -notmatch '^reports/.*\.html$' -and $_ -notmatch '^output/'
  })
  if ($releaseRelevantUntracked.Count -gt 0) {
    throw "Untracked source files may be missing from the release: $($releaseRelevantUntracked -join ', ')"
  }
  if ($untrackedFiles.Count -gt 0) {
    Write-Warning "Ignoring untracked report/output artifacts: $($untrackedFiles -join ', ')"
  }

  Invoke-CapturedCommand -Program "git" -Arguments @(
    "fetch", "origin", "master", "--tags", "--quiet"
  ) -FailureMessage "Could not refresh origin/master and tags." | Out-Null
  $localHeadOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "rev-parse", "HEAD"
  ) -FailureMessage "Could not read local HEAD.")
  $localHead = $localHeadOutput[-1].ToString().Trim()
  $remoteHeadOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "rev-parse", "origin/master"
  ) -FailureMessage "Could not read origin/master.")
  $remoteHead = $remoteHeadOutput[-1].ToString().Trim()
  if ($localHead -ne $remoteHead) {
    throw "Local HEAD does not match origin/master. Push or synchronize master first."
  }

  $latestTagOutput = @(Invoke-CapturedCommand -Program "gh" -Arguments @(
    "release", "view", "--repo", $repository, "--json", "tagName", "--jq", ".tagName"
  ) -FailureMessage "Could not read the latest GitHub Release.")
  $latestTag = $latestTagOutput[-1].ToString().Trim()
  $latestVersion = Normalize-Version $latestTag

  if ([string]::IsNullOrWhiteSpace($Version)) {
    $latestParts = $latestVersion.Split('.')
    $Version = "$($latestParts[0]).$($latestParts[1]).$([int]$latestParts[2] + 1)"
  } else {
    $Version = Normalize-Version $Version
  }

  if ([version]$Version -le [version]$latestVersion) {
    throw "Version $Version must be newer than the latest release $latestVersion."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & gh release view "v$Version" --repo $repository 2>$null | Out-Null
    $releaseLookupExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($releaseLookupExitCode -eq 0) {
    throw "Release v$Version already exists."
  }
  if ($releaseLookupExitCode -ne 1) {
    throw "Could not confirm whether release v$Version already exists."
  }

  if ([string]::IsNullOrWhiteSpace($Notes)) {
    $subjects = @(Invoke-CapturedCommand -Program "git" -Arguments @(
      "log", "$latestTag..origin/master", "--pretty=format:- %s"
    ) -FailureMessage "Could not build release notes." | ForEach-Object {
      $_.ToString().TrimEnd()
    } | Where-Object { $_ })
    $Notes = if ($subjects.Count -gt 0) {
      $subjects -join [Environment]::NewLine
    } else {
      "Technical Cookish $Version release."
    }
  }

  Write-Host "Repository: $repository"
  Write-Host "Source: master@$($localHead.Substring(0, 7))"
  Write-Host "Latest release: $latestTag"
  Write-Host "Next release: v$Version"
  Write-Host "Notes:"
  Write-Host $Notes

  if ($DryRun) {
    Write-Host "Dry run complete; no release was started."
    return
  }

  $dispatchOutput = @(Invoke-CapturedCommand -Program "gh" -Arguments @(
    "workflow", "run", $workflow,
    "--repo", $repository,
    "--ref", "master",
    "-f", "version=$Version",
    "-f", "notes=$Notes"
  ) -FailureMessage "Could not start the Android release workflow.")
  $runUrl = ($dispatchOutput | ForEach-Object { $_.ToString().Trim() } |
    Where-Object { $_ -match '^https://github\.com/.+/actions/runs/[0-9]+$' } |
    Select-Object -Last 1)
  if (-not $runUrl -or $runUrl -notmatch '/runs/([0-9]+)$') {
    throw "The workflow started, but its run URL could not be identified."
  }
  $runId = $Matches[1]
  Write-Host "Workflow: $runUrl"

  if ($NoWait) {
    Write-Host "Release started without waiting."
    return
  }

  & gh run watch $runId --repo $repository --exit-status --interval 10
  if ($LASTEXITCODE -ne 0) {
    throw "Android release workflow failed: $runUrl"
  }

  $releaseJson = (Invoke-CapturedCommand -Program "gh" -Arguments @(
    "release", "view", "v$Version", "--repo", $repository, "--json", "tagName,url,assets"
  ) -FailureMessage "Workflow succeeded, but the release could not be read.") -join ""
  $release = $releaseJson | ConvertFrom-Json
  $assetNames = @($release.assets | ForEach-Object { $_.name })
  $requiredAssets = @("Cookish.apk", "Cookish.apk.sha256", "update.json")
  $missingAssets = @($requiredAssets | Where-Object { $_ -notin $assetNames })
  if ($missingAssets.Count -gt 0) {
    throw "Release v$Version is missing assets: $($missingAssets -join ', ')"
  }

  $apkUrl = "https://github.com/$repository/releases/download/v$Version/Cookish.apk"
  Write-Host "Release complete: $($release.url)"
  Write-Host "APK: $apkUrl"
} finally {
  Pop-Location
}
