import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EXPECTED_REPOSITORY = "New-prg/cookish";
const ANDROID_MAX_VERSION_CODE = 2_100_000_000;
const IGNORED_UNTRACKED = [/^reports\/.*\.html$/, /^output\//];

export function lastNonEmptyLine(output) {
  const lines = textLines(output);
  if (lines.length === 0) {
    throw new Error("Command produced no usable output.");
  }
  return lines[lines.length - 1];
}

export function parseVersion(value) {
  const match = String(value ?? "").trim().match(/^v?([0-9]+)\.([0-9]+)\.([0-9]+)$/);
  if (!match) {
    throw new Error("Version must use MAJOR.MINOR.PATCH, for example 5.4.0.");
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function versionCode(version) {
  const [major, minor, patch] = parseVersion(version).split(".").map(Number);
  if (minor > 999 || patch > 999) {
    throw new Error("MINOR and PATCH must be between 0 and 999.");
  }
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (code < 1 || code > ANDROID_MAX_VERSION_CODE) {
    throw new Error(`Version code ${code} must fit Android's limit.`);
  }
  return code;
}

export function nextPatch(latestVersion) {
  const [major, minor, patch] = parseVersion(latestVersion).split(".").map(Number);
  if (patch >= 999) {
    throw new Error(
      `Cannot increment patch of ${parseVersion(latestVersion)}; supply an explicit version.`
    );
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left).split(".").map(Number);
  const rightParts = parseVersion(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function branchFromEnv(env) {
  if (env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  const ref = env.GITHUB_REF || "";
  if (ref === "refs/heads/master" || ref.endsWith("/master")) return "master";
  return ref.replace(/^refs\/heads\//, "");
}

export function factsFromGitHubActionsEnv(env = process.env) {
  return {
    expectedRepository: env.GITHUB_REPOSITORY || EXPECTED_REPOSITORY,
    actualRepository: env.GITHUB_REPOSITORY || "",
    branch: branchFromEnv(env),
    localHead: env.GITHUB_SHA || "",
    remoteHead: env.GITHUB_SHA || "",
    latestReleaseTag: env.LATEST_TAG || "",
    requestedVersion: env.INPUT_VERSION || "",
    existingGitTagsOutput: env.EXISTING_GIT_TAGS || "",
    existingReleaseTagsOutput: env.EXISTING_RELEASE_TAGS || "",
    notes: env.INPUT_NOTES || "",
    trackedChanges: [],
    untrackedFiles: [],
    dryRun: false,
  };
}

export function planAndroidRelease(facts = {}) {
  const expectedRepository = String(facts.expectedRepository || EXPECTED_REPOSITORY).trim();
  const actualRepository = requiredValue(
    facts,
    "actualRepository",
    "Could not identify the GitHub repository."
  );
  if (actualRepository !== expectedRepository) {
    throw new Error(`Expected ${expectedRepository}, found ${actualRepository}.`);
  }

  const branch = requiredValue(facts, "branch", "Could not read the current branch.");
  if (branch !== "master") {
    throw new Error(`Releases must run from master; current branch is ${branch}.`);
  }

  const trackedChanges = listValue(facts, "trackedChanges");
  if (trackedChanges.length > 0) {
    throw new Error(
      "Tracked changes are not committed. Finish, test, commit, and push them before releasing."
    );
  }

  const untrackedFiles = listValue(facts, "untrackedFiles");
  const releaseRelevantUntracked = untrackedFiles.filter(
    (file) => !IGNORED_UNTRACKED.some((pattern) => pattern.test(file))
  );
  if (releaseRelevantUntracked.length > 0) {
    throw new Error(
      `Untracked source files may be missing from the release: ${releaseRelevantUntracked.join(", ")}`
    );
  }

  const localHead = requiredValue(facts, "localHead", "Could not read local HEAD.");
  const remoteHead = requiredValue(facts, "remoteHead", "Could not read origin/master.");
  if (localHead !== remoteHead) {
    throw new Error("Local HEAD does not match origin/master. Push or synchronize master first.");
  }

  if (facts.latestReleaseExitCode != null && facts.latestReleaseExitCode !== 0) {
    throw new Error("Could not read the latest GitHub Release.");
  }
  const latestTag = requiredValue(
    facts,
    "latestReleaseTag",
    "Could not read the latest GitHub Release."
  );
  const latestVersion = parseVersion(latestTag);
  if (facts.latestReleaseVersion) {
    const namedVersion = parseVersion(facts.latestReleaseVersion);
    if (namedVersion !== latestVersion) {
      throw new Error(
        `Latest release tag ${latestTag} does not match version ${namedVersion}.`
      );
    }
  }

  const requested = String(facts.requestedVersion ?? "").trim();
  const version = requested ? parseVersion(requested) : nextPatch(latestVersion);
  if (compareVersions(version, latestVersion) <= 0) {
    throw new Error(`Version ${version} must be newer than the latest release ${latestVersion}.`);
  }

  const tag = `v${version}`;
  const existingGitTags = listValue(facts, "existingGitTags");
  const existingReleaseTags = listValue(facts, "existingReleaseTags");
  if (versionAlreadyPresent(existingGitTags, version) || versionAlreadyPresent(existingReleaseTags, version)) {
    throw new Error(`Release ${tag} already exists.`);
  }
  if (facts.releaseLookupExitCode === 0) {
    throw new Error(`Release ${tag} already exists.`);
  }
  if (hasFailedLookup(facts.releaseLookupExitCode)) {
    throw new Error(`Could not confirm whether release ${tag} already exists.`);
  }

  const notes = String(facts.notes ?? "").trim()
    || listValue(facts, "commitSubjects").join("\n")
    || `Technical Cookish ${version} release.`;

  return {
    repository: expectedRepository,
    version,
    tag,
    versionCode: versionCode(version),
    latestTag,
    latestVersion,
    notes,
    action: facts.dryRun ? "dry-run" : "publish",
    ignoredUntracked: untrackedFiles.filter((file) =>
      IGNORED_UNTRACKED.some((pattern) => pattern.test(file))
    ),
  };
}

function textLines(output) {
  return String(Array.isArray(output) ? output.map(String).join("\n") : output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listValue(facts, name) {
  if (Array.isArray(facts[name])) {
    return facts[name].map((item) => String(item).trim()).filter(Boolean);
  }
  const direct = facts[name];
  if (direct != null && direct !== "") {
    return textLines(direct);
  }
  return textLines(facts[`${name}Output`]);
}

function requiredValue(facts, name, missingMessage) {
  const direct = facts[name];
  if (direct != null && String(direct).trim() !== "") {
    return String(direct).trim();
  }
  const output = facts[`${name}Output`];
  if (output == null) {
    throw new Error(missingMessage);
  }
  try {
    return lastNonEmptyLine(output);
  } catch {
    throw new Error(missingMessage);
  }
}

function hasFailedLookup(exitCode) {
  return exitCode != null && exitCode !== 0 && exitCode !== 1;
}

function versionAlreadyPresent(tags, version) {
  return tags.some((tag) => {
    try {
      return parseVersion(tag) === version;
    } catch {
      return tag === version || tag === `v${version}`;
    }
  });
}

function readCliInput(args) {
  const file = args.find((value) => !value.startsWith("--"));
  if (file) {
    return fs.readFileSync(file, "utf8");
  }
  return fs.readFileSync(0, "utf8");
}

function writeGitHubOutput(plan) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }
  fs.appendFileSync(
    outputFile,
    `name=${plan.version}\ncode=${plan.versionCode}\ntag=${plan.tag}\n`
  );
}

function runCli(argv = process.argv.slice(2)) {
  const lastLineOnly = argv.includes("--last-line");
  const fromEnv = argv.includes("--from-env");
  const githubOutput = argv.includes("--github-output");
  if (lastLineOnly) {
    process.stdout.write(`${lastNonEmptyLine(readCliInput(argv))}\n`);
    return;
  }
  const facts = fromEnv
    ? factsFromGitHubActionsEnv(process.env)
    : JSON.parse(readCliInput(argv) || "{}");
  const plan = planAndroidRelease(facts);
  if (githubOutput) {
    writeGitHubOutput(plan);
  }
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exit(1);
  }
}
