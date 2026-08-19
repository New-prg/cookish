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
$policyScript = Join-Path $PSScriptRoot "release-policy.mjs"

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

function Convert-CommandOutput {
  param($Output)
  return (@($Output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
}

function Invoke-ReleasePolicy {
  param(
    [string[]]$Arguments = @(),
    [string]$InputText
  )

  $temp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText(
      $temp,
      $InputText,
      (New-Object System.Text.UTF8Encoding $false)
    )
    $output = @(& node $policyScript @Arguments $temp 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw ((@($output | ForEach-Object { $_.ToString() }) | Where-Object { $_ }) -join [Environment]::NewLine)
    }
    return $output
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Read-LastNonEmptyLine {
  param($Output)
  $result = @(Invoke-ReleasePolicy -Arguments @("--last-line") -InputText (Convert-CommandOutput $Output))
  return $result[-1].ToString().Trim()
}

Push-Location $projectRoot
try {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required."
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required to compute the release version."
  }
  Invoke-CapturedCommand -Program "gh" -Arguments @("auth", "status") `
    -FailureMessage "GitHub CLI is not authenticated." | Out-Null

  $actualRepositoryOutput = @(Invoke-CapturedCommand -Program "gh" -Arguments @(
    "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"
  ) -FailureMessage "Could not identify the GitHub repository.")
  $branchOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "branch", "--show-current"
  ) -FailureMessage "Could not read the current branch.")
  $trackedChangesOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "status", "--porcelain", "--untracked-files=no"
  ) -FailureMessage "Could not inspect tracked changes.")
  $untrackedFilesOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "ls-files", "--others", "--exclude-standard"
  ) -FailureMessage "Could not inspect untracked files.")

  Invoke-CapturedCommand -Program "git" -Arguments @(
    "fetch", "origin", "master", "--tags", "--quiet"
  ) -FailureMessage "Could not refresh origin/master and tags." | Out-Null
  $localHeadOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "rev-parse", "HEAD"
  ) -FailureMessage "Could not read local HEAD.")
  $remoteHeadOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "rev-parse", "origin/master"
  ) -FailureMessage "Could not read origin/master.")

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $latestTagOutput = @(& gh release view --repo $repository --json tagName --jq .tagName 2>&1)
    $latestReleaseExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  $existingGitTagsOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
    "tag", "--list"
  ) -FailureMessage "Could not list git tags.")
  $existingReleaseTagsOutput = @(Invoke-CapturedCommand -Program "gh" -Arguments @(
    "release", "list", "--repo", $repository, "--limit", "100", "--json", "tagName", "--jq", ".[].tagName"
  ) -FailureMessage "Could not list GitHub Releases.")

  $commitSubjectsOutput = @()
  if ($latestReleaseExitCode -eq 0) {
    $latestTag = Read-LastNonEmptyLine $latestTagOutput
    $commitSubjectsOutput = @(Invoke-CapturedCommand -Program "git" -Arguments @(
      "log", "$latestTag..origin/master", "--pretty=format:- %s"
    ) -FailureMessage "Could not build release notes.")
  }

  $facts = @{
    expectedRepository = $repository
    actualRepositoryOutput = (Convert-CommandOutput $actualRepositoryOutput)
    branchOutput = (Convert-CommandOutput $branchOutput)
    trackedChangesOutput = (Convert-CommandOutput $trackedChangesOutput)
    untrackedFilesOutput = (Convert-CommandOutput $untrackedFilesOutput)
    localHeadOutput = (Convert-CommandOutput $localHeadOutput)
    remoteHeadOutput = (Convert-CommandOutput $remoteHeadOutput)
    latestReleaseTagOutput = (Convert-CommandOutput $latestTagOutput)
    latestReleaseExitCode = $latestReleaseExitCode
    requestedVersion = $Version
    existingGitTagsOutput = (Convert-CommandOutput $existingGitTagsOutput)
    existingReleaseTagsOutput = (Convert-CommandOutput $existingReleaseTagsOutput)
    commitSubjectsOutput = (Convert-CommandOutput $commitSubjectsOutput)
    notes = $Notes
    dryRun = [bool]$DryRun
  }
  $planJson = @(Invoke-ReleasePolicy -InputText ($facts | ConvertTo-Json -Compress -Depth 6))
  $plan = $planJson[-1].ToString() | ConvertFrom-Json
  $localHead = Read-LastNonEmptyLine $localHeadOutput

  if ($plan.ignoredUntracked -and @($plan.ignoredUntracked).Count -gt 0) {
    Write-Warning ("Ignoring untracked report/output artifacts: " + ((@($plan.ignoredUntracked) | ForEach-Object { $_.ToString() }) -join ", "))
  }

  Write-Host "Repository: $($plan.repository)"
  Write-Host "Source: master@$($localHead.Substring(0, 7))"
  Write-Host "Latest release: $($plan.latestTag)"
  Write-Host "Next release: $($plan.tag)"
  Write-Host "Notes:"
  Write-Host $plan.notes

  if ($plan.action -eq "dry-run") {
    Write-Host "Dry run complete; no release was started."
    return
  }

  $dispatchOutput = @(Invoke-CapturedCommand -Program "gh" -Arguments @(
    "workflow", "run", $workflow,
    "--repo", $repository,
    "--ref", "master",
    "-f", "version=$($plan.version)",
    "-f", "notes=$($plan.notes)"
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
    "release", "view", $plan.tag, "--repo", $repository, "--json", "tagName,url,assets"
  ) -FailureMessage "Workflow succeeded, but the release could not be read.") -join ""
  $release = $releaseJson | ConvertFrom-Json
  $assetNames = @($release.assets | ForEach-Object { $_.name })
  $requiredAssets = @("Cookish.apk", "Cookish.apk.sha256", "update.json")
  $missingAssets = @($requiredAssets | Where-Object { $_ -notin $assetNames })
  if ($missingAssets.Count -gt 0) {
    throw "Release $($plan.tag) is missing assets: $($missingAssets -join ', ')"
  }

  $apkUrl = "https://github.com/$repository/releases/download/$($plan.tag)/Cookish.apk"
  Write-Host "Release complete: $($release.url)"
  Write-Host "APK: $apkUrl"
} finally {
  Pop-Location
}
