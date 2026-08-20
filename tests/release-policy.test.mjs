import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareVersions,
  factsFromGitHubActionsEnv,
  lastNonEmptyLine,
  nextPatch,
  parseVersion,
  planAndroidRelease,
  versionCode,
} from "../scripts/release-policy.mjs";

const policyPath = fileURLToPath(new URL("../scripts/release-policy.mjs", import.meta.url));
const releaseScript = fs.readFileSync(new URL("../scripts/release-android.ps1", import.meta.url), "utf8");
const workflowSource = fs.readFileSync(
  new URL("../.github/workflows/release-android.yml", import.meta.url),
  "utf8"
);
const appSource = fs.readFileSync(new URL("../mobile-shell/app.js", import.meta.url), "utf8");
const gradleSource = fs.readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");

function facts(overrides = {}) {
  return {
    expectedRepository: "New-prg/cookish",
    actualRepository: "New-prg/cookish",
    branch: "master",
    trackedChanges: [],
    untrackedFiles: [],
    localHead: "abc123",
    remoteHead: "abc123",
    latestReleaseTag: "v5.3.0",
    requestedVersion: "",
    existingGitTags: ["v5.3.0"],
    existingReleaseTags: ["v5.3.0"],
    commitSubjects: ["- Extract local data"],
    notes: "",
    dryRun: false,
    ...overrides,
  };
}

test("release command and workflow share the version policy module", () => {
  assert.match(releaseScript, /release-policy\.mjs/);
  assert.match(releaseScript, /\[switch\]\$DryRun/);
  assert.match(workflowSource, /scripts\/release-policy\.mjs/);
  assert.match(workflowSource, /--from-env/);
  assert.doesNotMatch(workflowSource, /5003000|newer than 5\.3\.0/);
  assert.doesNotMatch(appSource, /5\.3\.0/);
  assert.doesNotMatch(gradleSource, /5\.3\.0|5003000/);
});

test("last non-empty line survives CLI warnings and blank lines", () => {
  assert.equal(lastNonEmptyLine("warning: gh is noisy\n\n  v5.3.0  \n"), "v5.3.0");
  assert.equal(lastNonEmptyLine(["gh: hint", "", "New-prg/cookish"]), "New-prg/cookish");
  assert.throws(() => lastNonEmptyLine(""), /no usable output/);
  assert.throws(() => lastNonEmptyLine(["", "   "]), /no usable output/);
});

test("version parsing rejects tags that are not MAJOR.MINOR.PATCH", () => {
  assert.equal(parseVersion("v5.4.0"), "5.4.0");
  assert.equal(parseVersion("5.4.0"), "5.4.0");
  assert.throws(() => parseVersion("nightly"), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseVersion("5.4"), /MAJOR\.MINOR\.PATCH/);
});

test("default version is the next patch of the latest release", () => {
  const plan = planAndroidRelease(facts());
  assert.equal(plan.version, "5.3.1");
  assert.equal(plan.tag, "v5.3.1");
  assert.equal(plan.versionCode, 5_003_001);
  assert.equal(plan.action, "publish");
  assert.equal(nextPatch("v5.3.0"), "5.3.1");
  assert.equal(versionCode("5.4.0"), 5_004_000);
  assert.ok(compareVersions("5.3.1", "5.3.0") > 0);
});

test("missing previous release is an error instead of a hardcoded fallback", () => {
  assert.throws(
    () => planAndroidRelease(facts({ latestReleaseTag: "", latestReleaseTagOutput: "" })),
    /latest GitHub Release/
  );
  assert.throws(
    () => planAndroidRelease(facts({ latestReleaseTag: undefined, latestReleaseExitCode: 1 })),
    /latest GitHub Release/
  );
  assert.throws(
    () => planAndroidRelease(facts({ latestReleaseTag: "   ", latestReleaseTagOutput: "\n" })),
    /latest GitHub Release/
  );
});

test("tag and version must describe the same latest release", () => {
  assert.throws(
    () => planAndroidRelease(facts({ latestReleaseTag: "v5.3.0", latestReleaseVersion: "5.4.0" })),
    /does not match version 5\.4\.0/
  );
  assert.throws(
    () => planAndroidRelease(facts({ latestReleaseTag: "nightly" })),
    /MAJOR\.MINOR\.PATCH/
  );
  const plan = planAndroidRelease(
    facts({ latestReleaseTag: "5.3.0", latestReleaseVersion: "v5.3.0" })
  );
  assert.equal(plan.latestVersion, "5.3.0");
});

test("an existing tag or GitHub release blocks the planned version", () => {
  assert.throws(
    () => planAndroidRelease(facts({ requestedVersion: "5.3.1", existingGitTags: ["v5.3.0", "v5.3.1"] })),
    /already exists/
  );
  assert.throws(
    () => planAndroidRelease(facts({ requestedVersion: "5.3.1", existingReleaseTags: ["5.3.1"] })),
    /already exists/
  );
  assert.throws(
    () => planAndroidRelease(facts({ requestedVersion: "5.3.0" })),
    /must be newer than the latest release 5\.3\.0/
  );
});

test("dry run plans the next version without a publish action", () => {
  const plan = planAndroidRelease(facts({ dryRun: true }));
  assert.equal(plan.action, "dry-run");
  assert.equal(plan.version, "5.3.1");
  assert.equal(plan.tag, "v5.3.1");
  assert.match(releaseScript, /\$plan\.action -eq "dry-run"/);
  assert.match(releaseScript, /workflow", "run"/);
  const dryRunIndex = releaseScript.indexOf('$plan.action -eq "dry-run"');
  const dispatchIndex = releaseScript.indexOf('workflow", "run"');
  assert.ok(dryRunIndex > 0 && dispatchIndex > dryRunIndex);
});

test("untracked reports and output artifacts are ignored", () => {
  const plan = planAndroidRelease(
    facts({
      untrackedFiles: [
        "reports/cookish-full-product-audit-2026-08-13.html",
        "output/Cookish-debug.apk",
      ],
      dryRun: true,
    })
  );
  assert.equal(plan.action, "dry-run");
  assert.deepEqual(plan.ignoredUntracked, [
    "reports/cookish-full-product-audit-2026-08-13.html",
    "output/Cookish-debug.apk",
  ]);
  assert.throws(
    () => planAndroidRelease(facts({ untrackedFiles: ["mobile-shell/local-data.js"] })),
    /Untracked source files/
  );
});

test("CLI parsing of command output is used when planning a release", () => {
  const plan = planAndroidRelease(
    facts({
      actualRepository: "",
      actualRepositoryOutput: "warning: extra gh noise\nNew-prg/cookish\n",
      branch: "",
      branchOutput: "master\n",
      localHead: "",
      localHeadOutput: "abc123\n",
      remoteHead: "",
      remoteHeadOutput: "abc123\n",
      latestReleaseTag: "",
      latestReleaseTagOutput: "A new release of gh is available\nv5.3.0\n",
      existingGitTags: undefined,
      existingGitTagsOutput: "v5.2.9\nv5.3.0\n",
      commitSubjects: undefined,
      commitSubjectsOutput: "- Extract local data\n- Gate Android tests\n",
      dryRun: true,
    })
  );
  assert.equal(plan.latestTag, "v5.3.0");
  assert.equal(plan.version, "5.3.1");
  assert.equal(plan.notes, "- Extract local data\n- Gate Android tests");
  assert.equal(plan.action, "dry-run");
});

test("GitHub Actions env adapter feeds the same planner", () => {
  const plan = planAndroidRelease(
    factsFromGitHubActionsEnv({
      GITHUB_REPOSITORY: "New-prg/cookish",
      GITHUB_REF_NAME: "master",
      GITHUB_SHA: "def456",
      LATEST_TAG: "v5.3.0",
      INPUT_VERSION: "",
      INPUT_NOTES: "Ship the next patch.",
      EXISTING_GIT_TAGS: "v5.3.0",
      EXISTING_RELEASE_TAGS: "v5.3.0",
    })
  );
  assert.equal(plan.version, "5.3.1");
  assert.equal(plan.versionCode, 5_003_001);
  assert.equal(plan.notes, "Ship the next patch.");
  assert.equal(plan.action, "publish");
});

test("policy CLI prints a dry-run plan and last command line", () => {
  const lastLine = spawnSync(process.execPath, [policyPath, "--last-line"], {
    encoding: "utf8",
    input: "warning\n\nv5.3.0\n",
  });
  assert.equal(lastLine.status, 0, lastLine.stderr);
  assert.equal(lastLine.stdout.trim(), "v5.3.0");

  const factsFile = path.join(os.tmpdir(), `cookish-release-facts-${process.pid}.json`);
  fs.writeFileSync(
    factsFile,
    JSON.stringify(facts({ dryRun: true, requestedVersion: "5.4.0" })),
    "utf8"
  );
  const planned = spawnSync(process.execPath, [policyPath, factsFile], { encoding: "utf8" });
  fs.unlinkSync(factsFile);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.action, "dry-run");
  assert.equal(plan.version, "5.4.0");
  assert.equal(plan.tag, "v5.4.0");
});
