import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseMetadata } from "./release-metadata.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = join(dirname(SCRIPT_PATH), "..");

/**
 * Release-note contract: when a version has no special declaration
 * (docs/releases/<tag>.md is absent), the published release body is exactly
 * one line — the Full Changelog compare from the previous version tag to the
 * current tag:
 *
 * **Full Changelog**: https://github.com/<owner>/<repo>/compare/<prev>...<tag>
 */

/**
 * @param {string[]} tags version tags sorted newest first (version:refname)
 * @param {string} current the tag being released
 * @returns {string} the version tag immediately before `current`
 */
export function findPreviousVersionTag(tags, current) {
  const currentIndex = tags.indexOf(current);
  if (currentIndex === -1) {
    throw new Error(`Current tag ${current} is not in the version tag list.`);
  }
  const previous = tags[currentIndex + 1];
  if (previous === undefined) {
    throw new Error(
      `No previous version tag found before ${current}; write an explicit docs/releases/${current}.md instead.`,
    );
  }
  return previous;
}

/**
 * @param {string} repository GitHub owner/repo slug
 * @param {string} previousTag
 * @param {string} currentTag
 * @returns {string}
 */
export function formatDefaultFullChangelog(repository, previousTag, currentTag) {
  return `**Full Changelog**: https://github.com/${repository}/compare/${previousTag}...${currentTag}\n`;
}

/**
 * @param {string} remoteUrl origin remote URL
 * @returns {string} owner/repo slug
 */
export function parseRepositorySlug(remoteUrl) {
  const cleaned = remoteUrl.trim().replace(/\.git$/, "");
  const match = /github\.com[:/](.+?)$/.exec(cleaned);
  if (match === null) {
    throw new Error(`Cannot derive the GitHub repository slug from origin remote: ${remoteUrl}`);
  }
  return match[1].replace(/^\/+|\/+$/g, "");
}

function listVersionTags() {
  const output = execFileSync("git", ["tag", "--sort=-version:refname", "--list", "v*"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
  return output === "" ? [] : output.split("\n").map((line) => line.trim());
}

function resolveRepositorySlug() {
  const fromEnvironment = process.env.GITHUB_REPOSITORY?.trim();
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  return parseRepositorySlug(remoteUrl);
}

function main() {
  const metadata = readReleaseMetadata(join(REPOSITORY_ROOT, "package.json"));
  const notesPath = join(REPOSITORY_ROOT, metadata.releaseNotesPath);
  if (existsSync(notesPath)) {
    console.log(`[release-notes] ${metadata.releaseNotesPath} exists; using the declared notes.`);
    return;
  }
  const previous = findPreviousVersionTag(listVersionTags(), metadata.expectedTag);
  const notes = formatDefaultFullChangelog(
    resolveRepositorySlug(),
    previous,
    metadata.expectedTag,
  );
  mkdirSync(dirname(notesPath), { recursive: true });
  writeFileSync(notesPath, notes, "utf8");
  console.log(
    `[release-notes] generated ${metadata.releaseNotesPath} (${previous}...${metadata.expectedTag}).`,
  );
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}