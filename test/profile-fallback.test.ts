import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healProfilesModuleFallback } from "@deepseek-ai/dsh-app-boot";

const DEP_NAME = "@deepseek-ai/fallback-probe";
const DEP_VERSION = "1.0.0";

/**
 * Windows NTFS junctions are reported by lstat as directories, and their
 * readlink targets can carry an NT namespace prefix; both must be tolerated
 * when the assertions run on windows-latest CI.
 */
function comparableLinkTarget(value: string): string {
  if (process.platform !== "win32") return value;
  return value
    .replaceAll("/", "\\")
    .replace(/^\\\\\?\\/, "")
    .replace(/^\??\\/, "")
    .toLowerCase();
}

/** Write a minimal installation whose dependency closure is the probe package. */
async function writeInstallation(root: string): Promise<string> {
  const depDir = join(root, "node_modules", ...DEP_NAME.split("/"));
  await mkdir(depDir, { recursive: true });
  await writeFile(
    join(depDir, "package.json"),
    JSON.stringify({ name: DEP_NAME, version: DEP_VERSION }),
  );
  const anchor = join(root, "package.json");
  await writeFile(
    anchor,
    JSON.stringify({
      name: "fallback-probe-install",
      version: "1.0.0",
      dependencies: { [DEP_NAME]: DEP_VERSION },
    }),
  );
  return anchor;
}

describe("healProfilesModuleFallback", () => {
  it("creates the flat fallback link and keeps it on an identical second heal", async () => {
    // Given: one installation and a fresh DSH home
    const parent = await mkdtemp(join(tmpdir(), "dsh-flightdeck-fallback-"));
    const installationRoot = join(parent, "install");
    const anchor = await writeInstallation(installationRoot);
    const home = join(parent, "home");
    const link = join(home, "profiles", "node_modules", DEP_NAME);

    try {
      // When: the fallback heals once, then heals again over the same link
      await healProfilesModuleFallback(anchor, home);
      await healProfilesModuleFallback(anchor, home);

      // Then: the managed link still resolves to the same package directory
      expect(comparableLinkTarget(await readlink(link))).toBe(
        comparableLinkTarget(join(installationRoot, "node_modules", DEP_NAME)),
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("re-points an existing managed fallback link when the installation moves", async () => {
    // Given: two installations at different roots sharing one DSH home
    const parent = await mkdtemp(join(tmpdir(), "dsh-flightdeck-fallback-"));
    const firstRoot = join(parent, "install-first");
    const secondRoot = join(parent, "install-second");
    const firstAnchor = await writeInstallation(firstRoot);
    const secondAnchor = await writeInstallation(secondRoot);
    const home = join(parent, "home");
    const link = join(home, "profiles", "node_modules", DEP_NAME);

    try {
      // When: the first installation heals, then the second one heals the same home
      await healProfilesModuleFallback(firstAnchor, home);
      await healProfilesModuleFallback(secondAnchor, home);

      // Then: the link was removed and recreated against the second installation
      expect(comparableLinkTarget(await readlink(link))).toBe(
        comparableLinkTarget(join(secondRoot, "node_modules", DEP_NAME)),
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("still rejects a real directory where a managed link belongs", async () => {
    // Given: a fresh DSH home where the fallback slot is an actual directory
    const parent = await mkdtemp(join(tmpdir(), "dsh-flightdeck-fallback-"));
    const anchor = await writeInstallation(join(parent, "install"));
    const home = join(parent, "home");
    const link = join(home, "profiles", "node_modules", DEP_NAME);
    await mkdir(link, { recursive: true });
    await writeFile(join(link, "keep.txt"), "user data");

    try {
      // When: healing meets an unmanaged directory, Then: it fails loud instead of deleting it
      expect(() => healProfilesModuleFallback(anchor, home)).toThrow(
        /exists and is not a symlink/,
      );
      expect(await readFile(join(link, "keep.txt"), "utf8")).toBe("user data");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
