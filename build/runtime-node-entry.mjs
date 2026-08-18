import { pathToFileURL } from "node:url";

function markFatal(eventName) {
  console.error(`[desktop-runtime] ${eventName}`);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

process.on("uncaughtException", () => markFatal("uncaughtException"));
process.on("unhandledRejection", () => markFatal("unhandledRejection"));

const dshBin = process.argv[2];
process.argv = [...process.argv.slice(0, 2), ...process.argv.slice(3)];

console.log(`[desktop-runtime] Node=${process.version}`);
console.log(`[desktop-runtime] platform=${process.platform}`);
console.log(`[desktop-runtime] arch=${process.arch}`);
console.log(`[desktop-runtime] execPath=${process.execPath}`);
console.log(`[desktop-runtime] cwd=${process.cwd()}`);
console.log(`[desktop-runtime] DSH_HOME=${process.env.DSH_HOME ?? "<unset>"}`);

if (dshBin === undefined || dshBin === "") {
  console.error("[desktop-runtime] missing DSH bin argument");
  process.exitCode = 1;
} else {
  await import(pathToFileURL(dshBin).href);
}
