import { access, cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Seeds a fresh DSH_HOME with the vendored web profile on first launch.
 *
 * The upstream DSH runtime initializes a missing `web` profile from a
 * template with empty dependencies, and `dsh plugin` (pnpm + network) is
 * its only supported installer — so the packaged app ships a prepared
 * profile instead and copies it in exactly once. A later launch never
 * overwrites a profile the user has since modified, because the seed is
 * keyed on the target manifest's existence.
 *
 * @returns true when the profile was seeded, false when it already existed.
 */
export async function seedWebProfile(dshHome: string, sourceDir: string): Promise<boolean> {
  const targetDir = join(dshHome, "profiles", "web");
  const targetManifest = join(targetDir, "package.json");
  if (await isReadable(targetManifest)) {
    return false;
  }
  await mkdir(targetDir, { recursive: true });
  // Copy the staged entries one by one so the layout is independent of
  // fs.cp's directory-merge semantics across Node versions.
  for (const entry of await readdir(sourceDir)) {
    await cp(join(sourceDir, entry), join(targetDir, entry), { recursive: true });
  }
  return true;
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
