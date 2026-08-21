import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const BUILD_IDENTIFIER = "[0-9A-Za-z-]+";
const SEMVER_PATTERN = new RegExp(
  `^(${NUMERIC_IDENTIFIER})\\.(${NUMERIC_IDENTIFIER})\\.(${NUMERIC_IDENTIFIER})` +
    `(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?` +
    `(?:\\+(${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*))?$`,
);

/**
 * @typedef {Object} ReleaseMetadata
 * @property {string} flightdeckVersion
 * @property {string} dshVersion
 * @property {string} expectedTag
 * @property {boolean} isPrerelease
 * @property {string} windowsFilename
 * @property {string} windowsPath
 * @property {string} windowsArtifactName
 * @property {string} macFilename
 * @property {string} macPath
 * @property {string} macArtifactName
 * @property {string} releaseTitle
 * @property {string} releaseNotesPath
 */

/**
 * Parse and validate a strict SemVer 2.0.0 version.
 * @param {unknown} value
 * @param {string} label
 * @returns {{version: string, prerelease: string | undefined}}
 */
export function parseSemVer(value, label = "version") {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a strict SemVer string.`);
  }
  const match = SEMVER_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`${label} must be a strict SemVer string; received ${JSON.stringify(value)}.`);
  }
  return { version: value, prerelease: match[4] };
}

/**
 * @param {unknown} dependency
 * @returns {string}
 */
function parseExactDshVersion(dependency) {
  if (typeof dependency !== "string" || dependency.length === 0) {
    throw new Error("dependencies[@deepseek-ai/dsh] must be an exact SemVer string.");
  }
  return parseSemVer(dependency, "dependencies[@deepseek-ai/dsh]").version;
}

/**
 * @param {Record<string, unknown>} packageJson
 * @param {string | undefined} releaseTag
 * @returns {ReleaseMetadata}
 */
export function deriveReleaseMetadata(packageJson, releaseTag = undefined) {
  if (packageJson === null || typeof packageJson !== "object") {
    throw new Error("package.json must contain an object.");
  }
  const flightdeck = parseSemVer(packageJson.version, "package.json version");
  const dependencies = packageJson.dependencies;
  if (dependencies === null || typeof dependencies !== "object") {
    throw new Error("package.json dependencies must contain an object.");
  }
  const dshVersion = parseExactDshVersion(dependencies["@deepseek-ai/dsh"]);
  const flightdeckVersion = flightdeck.version;
  const expectedTag = `v${flightdeckVersion}`;
  if (releaseTag !== undefined && releaseTag !== "" && releaseTag !== expectedTag) {
    throw new Error(
      `Release tag ${releaseTag} does not match package version ${flightdeckVersion} (expected ${expectedTag}).`,
    );
  }

  const windowsFilename =
    `dsh-flightdeck-${flightdeckVersion}-dsh-${dshVersion}-windows-x64-setup.exe`;
  const windowsPath = join("dist", windowsFilename).replaceAll("\\", "/");
  const windowsArtifactName =
    `dsh-flightdeck-${flightdeckVersion}-dsh-${dshVersion}-windows-x64-nsis`;
  const macFilename = `dsh-flightdeck-${flightdeckVersion}-dsh-${dshVersion}-mac-arm64.dmg`;
  const macPath = join("dist", macFilename).replaceAll("\\", "/");
  const macArtifactName = `dsh-flightdeck-${flightdeckVersion}-dsh-${dshVersion}-mac-arm64-dmg`;
  const releaseNotesPath = join("docs", "releases", `${expectedTag}.md`).replaceAll("\\", "/");

  return {
    flightdeckVersion,
    dshVersion,
    expectedTag,
    isPrerelease: flightdeck.prerelease !== undefined,
    windowsFilename,
    windowsPath,
    windowsArtifactName,
    macFilename,
    macPath,
    macArtifactName,
    releaseTitle: `DSH Flightdeck v${flightdeckVersion}`,
    releaseNotesPath,
  };
}

/**
 * @param {string} packagePath
 * @returns {ReleaseMetadata}
 */
export function readReleaseMetadata(packagePath = join(process.cwd(), "package.json")) {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  return deriveReleaseMetadata(packageJson, process.env.RELEASE_TAG);
}

const OUTPUT_FIELDS = /** @type {const} */ ([
  ["flightdeck_version", "flightdeckVersion"],
  ["dsh_version", "dshVersion"],
  ["expected_tag", "expectedTag"],
  ["is_prerelease", "isPrerelease"],
  ["windows_filename", "windowsFilename"],
  ["windows_path", "windowsPath"],
  ["windows_artifact_name", "windowsArtifactName"],
  ["mac_filename", "macFilename"],
  ["mac_path", "macPath"],
  ["mac_artifact_name", "macArtifactName"],
  ["release_title", "releaseTitle"],
  ["release_notes_path", "releaseNotesPath"],
]);

/**
 * @param {ReleaseMetadata} metadata
 * @returns {string}
 */
export function formatGitHubOutputs(metadata) {
  return OUTPUT_FIELDS.map(([name, property]) => `${name}=${metadata[property]}`).join("\n") + "\n";
}

function writeOutputs(metadata) {
  const output = formatGitHubOutputs(metadata);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

function isMainModule() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_PATH;
}

if (isMainModule()) {
  try {
    writeOutputs(readReleaseMetadata());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release-metadata: ${message}`);
    process.exitCode = 1;
  }
}
