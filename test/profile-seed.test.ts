import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedWebProfile } from "../src/main/profile-seed.js";

async function writeStagedProfile(root: string): Promise<string> {
  const sourceDir = join(root, "staged");
  await mkdir(join(sourceDir, "node_modules", "dshmarket"), { recursive: true });
  await mkdir(join(sourceDir, "node_modules", "dsh-find-plugin"), { recursive: true });
  await mkdir(join(sourceDir, "node_modules", "dsh-anchored-subagent"), { recursive: true });
  await mkdir(join(sourceDir, "node_modules", "dsh-better-sidebar"), { recursive: true });
  await writeFile(join(sourceDir, "package.json"), '{"name":"dsh-profile-web"}\n', "utf8");
  await writeFile(join(sourceDir, "cordis.patch.yml"), "[]\n", "utf8");
  await writeFile(join(sourceDir, "pnpm-workspace.yaml"), "nodeLinker: hoisted\nautoInstallPeers: false\n", "utf8");
  await writeFile(join(sourceDir, "node_modules", "dshmarket", "package.json"), '{"name":"dshmarket"}\n', "utf8");
  await writeFile(join(sourceDir, "node_modules", "dsh-find-plugin", "package.json"), '{"name":"dsh-find-plugin"}\n', "utf8");
  await writeFile(
    join(sourceDir, "node_modules", "dsh-anchored-subagent", "package.json"),
    '{"name":"dsh-anchored-subagent"}\n',
    "utf8",
  );
  await writeFile(
    join(sourceDir, "node_modules", "dsh-better-sidebar", "package.json"),
    '{"name":"dsh-better-sidebar"}\n',
    "utf8",
  );
  return sourceDir;
}

describe("profile seed", () => {
  it("copies the staged web profile into a fresh DSH_HOME on first launch", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-seed-first-"));
    try {
      const sourceDir = await writeStagedProfile(root);
      const dshHome = join(root, "harness");

      const seeded = await seedWebProfile(dshHome, sourceDir);

      expect(seeded).toBe(true);
      expect(await readFile(join(dshHome, "profiles", "web", "package.json"), "utf8")).toContain("dsh-profile-web");
      expect(await readFile(join(dshHome, "profiles", "web", "cordis.patch.yml"), "utf8")).toBe("[]\n");
      expect(
        await readFile(join(dshHome, "profiles", "web", "pnpm-workspace.yaml"), "utf8"),
      ).toContain("autoInstallPeers: false");
      expect(await readFile(join(dshHome, "profiles", "web", "node_modules", "dshmarket", "package.json"), "utf8")).toContain("dshmarket");
      expect(
        await readFile(join(dshHome, "profiles", "web", "node_modules", "dsh-find-plugin", "package.json"), "utf8"),
      ).toContain("dsh-find-plugin");
      expect(
        await readFile(join(dshHome, "profiles", "web", "node_modules", "dsh-anchored-subagent", "package.json"), "utf8"),
      ).toContain("dsh-anchored-subagent");
      expect(
        await readFile(join(dshHome, "profiles", "web", "node_modules", "dsh-better-sidebar", "package.json"), "utf8"),
      ).toContain("dsh-better-sidebar");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never overwrites an existing web profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-seed-existing-"));
    try {
      const sourceDir = await writeStagedProfile(root);
      const dshHome = join(root, "harness");
      const webDir = join(dshHome, "profiles", "web");
      await mkdir(webDir, { recursive: true });
      await writeFile(join(webDir, "package.json"), '{"name":"user-owned"}\n', "utf8");

      const seeded = await seedWebProfile(dshHome, sourceDir);

      expect(seeded).toBe(false);
      expect(await readFile(join(webDir, "package.json"), "utf8")).toBe('{"name":"user-owned"}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing staged source so the caller can degrade to template initialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-seed-missing-"));
    try {
      await expect(seedWebProfile(join(root, "harness"), join(root, "does-not-exist"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
