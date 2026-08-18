import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

function describeFailure(eventName, failure) {
  const detail = failure instanceof Error ? (failure.stack ?? `${failure.name}: ${failure.message}`) : String(failure);
  return `[desktop-runtime] ${eventName}${detail === "" ? "" : `: ${detail}`}`;
}

function markFatal(eventName, failure) {
  // writeSync: pending async stderr writes are lost when process.exit runs,
  // and the packaged smoke gate depends on this line reaching the log.
  writeSync(2, `${describeFailure(eventName, failure)}\n`);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

process.on("uncaughtException", (error) => markFatal("uncaughtException", error));
process.on("unhandledRejection", (reason) => markFatal("unhandledRejection", reason));

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
