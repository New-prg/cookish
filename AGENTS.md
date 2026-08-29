# Cookish agent instructions

## Branch policy

Work directly on `master`. For long, risky rework that cannot reach green in one
session, use a disposable `refactor/*` branch, land it with a single PR, and
delete the branch after the merge. Do not create other branches (including
agent-session branches like `t3code/*`); remove leftover worktrees when deleting
their branches. Push `master` at the end of every session so work is never
local-only. Use `git revert` to undo a bad commit instead of keeping a parallel
branch.

## Current development plan

The plan lives in GitHub issues, not in repo files. Source of truth is epic #21
(`gh issue view 21`): phased checklist with the execution order.

- Active slice: milestone «Рацион: локальный срез», in order
  #22 → #23 → #24/#25 (#26 in parallel) → #27 → #28 → #38 → #37.
- #37 is the release gate: issues in milestone «После локального среза»
  (#29–#36) must not start until #37 is done.
- Milestone «Бэклог» issues are parked; do not reopen them without the user.
- When starting implementation, read the epic, then the first open issue of the
  slice; close issues as their scope lands and push `master` after each session.

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
