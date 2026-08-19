// Platform-target gate for packaging scripts. Packaging has exactly two
// approved targets — Windows x64 and macOS (darwin) arm64 — and this script
// fails fast anywhere else so no cross-platform artifact is ever produced
// silently.

const [expectedPlatform, expectedArch] = process.argv.slice(2);

if (expectedPlatform === undefined || expectedArch === undefined) {
  console.error("usage: node scripts/verify-target.mjs <platform> <arch>");
  process.exit(2);
}

const { platform, arch } = process;

if (platform !== expectedPlatform || arch !== expectedArch) {
  console.error(
    `target mismatch: expected ${expectedPlatform}/${expectedArch}, running on ${platform}/${arch}`,
  );
  process.exit(1);
}

console.log(`confirmed target: ${expectedPlatform} ${expectedArch}`);
