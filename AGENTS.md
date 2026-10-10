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

The plan lives in GitHub issues, not in repo files. Source of truth is epic #59
(`gh issue view 59`): the assistant on Claude Haiku 5.5, context compaction and
AI filling of product nutrition from Open Food Facts and the built-in reference.
Epic #44 (three pages and the test assistant) is done; epic #21 keeps the
overall history.

- Active slice: milestone «Haiku и заполнение каталога ИИ».
  Start points without dependencies: #60 (Haiku), #62 (input without КБЖУ),
  #63 (reference). Then #60 → #61; #63 → #64; #60 + #62 + #64 → #65.
- Each issue lists its dependencies; do not start an issue before they are closed.
- Backend, account, sync and AI proxy (#29–#32) come after #59. #36 holds AI
  eval fixtures. #42 is the end-to-end QA and comes last.
- The AI provider key is never committed or bundled. The app reads it from the
  temporary Profile field; `scripts/ai-lab/` reads it from the local opencode config.
- Milestone «Бэклог» issues are parked; do not reopen them without the user.
- When starting implementation, read the epic, then the issue; close issues as
  their scope lands and push `master` after each session.

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
