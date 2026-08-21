import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const METADATA_SCRIPT = join(REPOSITORY_ROOT, "scripts/release-metadata.mjs");

type FixturePackage = {
  version?: string;
  dependencies?: Record<string, string>;
};

async function runMetadata(fixture: FixturePackage, releaseTag?: string) {
  const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-release-metadata-"));
  try {
    const outputPath = join(root, "github-output");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: fixture.version ?? "0.1.0-rc.9",
        dependencies: fixture.dependencies ?? { "@deepseek-ai/dsh": "0.1.0-rc.7" },
      }),
    );
    const { NODE_OPTIONS: _nodeOptions, RELEASE_TAG: _releaseTag, ...baseEnv } = process.env;
    const env = {
      ...baseEnv,
      GITHUB_OUTPUT: outputPath,
      ...(releaseTag === undefined ? {} : { RELEASE_TAG: releaseTag }),
    };
    await execFile(process.execPath, [METADATA_SCRIPT], { cwd: root, env });
    const output = await readFile(outputPath, "utf8");
    return new Map(
      output
        .trimEnd()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)] as const;
        }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("release-metadata.mjs", () => {
  it("derives exact prerelease metadata and GitHub outputs", async () => {
    const output = await runMetadata({ version: "0.1.0-rc.9" }, "v0.1.0-rc.9");

    expect(output.get("flightdeck_version")).toBe("0.1.0-rc.9");
    expect(output.get("dsh_version")).toBe("0.1.0-rc.7");
    expect(output.get("expected_tag")).toBe("v0.1.0-rc.9");
    expect(output.get("is_prerelease")).toBe("true");
    expect(output.get("windows_filename")).toBe(
      "dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-windows-x64-setup.exe",
    );
    expect(output.get("windows_path")).toBe(
      "dist/dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-windows-x64-setup.exe",
    );
    expect(output.get("windows_artifact_name")).toBe(
      "dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-windows-x64-nsis",
    );
    expect(output.get("mac_filename")).toBe("dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-mac-arm64.dmg");
    expect(output.get("mac_path")).toBe("dist/dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-mac-arm64.dmg");
    expect(output.get("mac_artifact_name")).toBe(
      "dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-mac-arm64-dmg",
    );
    expect(output.get("release_title")).toBe("DSH Flightdeck v0.1.0-rc.9");
    expect(output.get("release_notes_path")).toBe("docs/releases/v0.1.0-rc.9.md");
  });

  it("treats stable SemVer, including build metadata, as a non-prerelease", async () => {
    const output = await runMetadata({ version: "0.1.0+build.2", dependencies: { "@deepseek-ai/dsh": "0.1.0" } }, "v0.1.0+build.2");

    expect(output.get("is_prerelease")).toBe("false");
    expect(output.get("expected_tag")).toBe("v0.1.0+build.2");
    expect(output.get("windows_filename")).toContain("dsh-flightdeck-0.1.0+build.2-dsh-0.1.0-windows-x64-setup.exe");
    expect(output.get("release_title")).toBe("DSH Flightdeck v0.1.0+build.2");
    expect(output.get("release_notes_path")).toBe("docs/releases/v0.1.0+build.2.md");
  });

  it("rejects a tag that does not exactly match package.json version", async () => {
    await expect(runMetadata({ version: "0.1.0-rc.9" }, "v0.1.0-rc.10")).rejects.toThrow(
      /expected v0\.1\.0-rc\.9/,
    );
  });

  it("rejects a DSH dependency range", async () => {
    await expect(
      runMetadata({ dependencies: { "@deepseek-ai/dsh": "^0.1.0-rc.7" } }),
    ).rejects.toThrow(/strict SemVer/);
  });

  it("rejects missing DSH metadata and invalid Flightdeck versions", async () => {
    await expect(runMetadata({ dependencies: {} })).rejects.toThrow(/exact SemVer/);
    await expect(runMetadata({ version: "0.1.0-" })).rejects.toThrow(/strict SemVer/);
  });
});
