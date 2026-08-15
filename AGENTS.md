# Cookish agent instructions

## Android releases

When the user says that it is time for a new version, asks to release an APK,
or uses similar wording, treat that message as authorization to publish the next
Cookish Android release from `master`.

Use `scripts/release-android.ps1`; do not recreate the `gh workflow run` sequence
manually. Unless the user supplies a version, use the script's default next patch
version. Unless the user supplies notes, let the script build notes from commits
since the latest release.

Before releasing:

1. Finish and test the intended application changes.
2. Commit and push only intended changes to `master`. Never stage unrelated user
   files or reports.
3. Ensure local `HEAD` matches `origin/master`.
4. Run a dry run first:
   `powershell -ExecutionPolicy Bypass -File scripts/release-android.ps1 -DryRun`
5. Publish and wait for completion:
   `powershell -ExecutionPolicy Bypass -File scripts/release-android.ps1`

For an explicit version or notes, pass `-Version X.Y.Z` and `-Notes "..."`.
Stay with the GitHub Actions run until it succeeds or reaches a concrete failure.
On success, return both the release page and direct APK link. Do not rotate,
replace, print, or reconstruct the Android signing key; the workflow reads the
existing GitHub Secrets.
