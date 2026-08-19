import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIFECYCLE } from "../src/shared/contracts.js";
import { reserveLoopbackPort } from "../src/main/reserve-port.js";
import { resolveRuntimePaths } from "../src/main/runtime-paths.js";
import {
  buildHarnessArguments,
  buildHarnessSpawnOptions,
  buildNodeArguments,
  endpointDiscoveryLine,
  formatExitCode,
  HarnessRuntime,
  isReadyStatus,
  ReadinessOriginError,
  waitUntilReady,
  withPrependedPath,
} from "../src/main/runtime.js";

describe("LIFECYCLE", () => {
  it("fixes the exact lifecycle timing constants from plan section 5.3", () => {
    // Given: the single home for timing values, src/shared/contracts.ts
    // When: the lifecycle object is read
    // Then: every constant matches the plan exactly
    expect(LIFECYCLE.windowsStartupTimeoutMs).toBe(120_000);
    expect(LIFECYCLE.defaultStartupTimeoutMs).toBe(45_000);
    expect(LIFECYCLE.readinessPollIntervalMs).toBe(250);
    expect(LIFECYCLE.httpRequestTimeoutMs).toBe(1_000);
    expect(LIFECYCLE.stopGracePeriodMs).toBe(4_000);
    expect(LIFECYCLE.progressLogIntervalMs).toBe(10_000);
    expect(LIFECYCLE.maxRetainedLogLines).toBe(200);
  });
});

describe("resolveRuntimePaths", () => {
  it("resolves dev-mode paths on darwin with the bare node binary and build assets", () => {
    // Given: development mode rooted at the repository
    const appRoot = "/Users/tester/dsh-flightdeck";

    // When: the runtime paths are resolved for darwin
    const paths = resolveRuntimePaths({ mode: "dev", platform: "darwin", appRoot });

    // Then: the bundled node binary, DSH CLI entry, and build runtime entry are exact
    expect(paths.nodeExecutable).toBe("/Users/tester/dsh-flightdeck/node_modules/node/bin/node");
    expect(paths.dshBin).toBe("/Users/tester/dsh-flightdeck/node_modules/@deepseek-ai/dsh/lib/bin.js");
    expect(paths.runtimeEntry).toBe("/Users/tester/dsh-flightdeck/build/runtime-node-entry.mjs");
    expect(paths.assetsDir).toBe("/Users/tester/dsh-flightdeck/build");
  });

  it("resolves packaged-mode paths on win32 with node.exe and resources assets", () => {
    // Given: packaged mode rooted at the installed resources/app directory
    const appRoot = "C:\\Program Files\\DSH Flightdeck\\resources\\app";

    // When: the runtime paths are resolved for win32
    const paths = resolveRuntimePaths({ mode: "packaged", platform: "win32", appRoot });

    // Then: node.exe, DSH CLI entry, and the resources copy of the runtime entry are exact
    expect(paths.nodeExecutable).toBe(
      "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe",
    );
    expect(paths.dshBin).toBe(
      "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js",
    );
    expect(paths.runtimeEntry).toBe("C:\\Program Files\\DSH Flightdeck\\resources\\runtime-node-entry.mjs");
    expect(paths.assetsDir).toBe("C:\\Program Files\\DSH Flightdeck\\resources");
  });
});

describe("buildHarnessArguments", () => {
  it("builds the web host and port flags from a reserved port", () => {
    // Given: a concrete reserved loopback port
    // When: the DSH harness arguments are built
    const args = buildHarnessArguments(43127);

    // Then: DSH receives web --host 127.0.0.1 --port <port>
    expect(args).toEqual(["web", "--host", "127.0.0.1", "--port", "43127"]);
  });
});

describe("endpointDiscoveryLine", () => {
  it("formats the exact desktop endpoint discovery marker", () => {
    // Given: the exact IPv4 loopback origin consumed by desktop smoke discovery
    const origin = "http://127.0.0.1:43127";

    // When: the endpoint discovery marker is built
    const line = endpointDiscoveryLine(origin);

    // Then: the marker remains machine-readable and exact
    expect(line).toBe("[desktop] endpoint http://127.0.0.1:43127");
  });
});

describe("buildNodeArguments", () => {
  it("prepends --expose-internals, the runtime entry, and the DSH entry", () => {
    // Given: resolved dev runtime paths and a concrete reserved port
    const paths = resolveRuntimePaths({ mode: "dev", platform: "darwin", appRoot: "/Users/tester/dsh-flightdeck" });
    const harnessArgs = buildHarnessArguments(43127);

    // When: the full node argument list is built
    const nodeArgs = buildNodeArguments(paths.runtimeEntry, paths.dshBin, harnessArgs);

    // Then: --expose-internals, the runtime entry, and the DSH entry lead the harness arguments
    expect(nodeArgs).toEqual([
      "--expose-internals",
      paths.runtimeEntry,
      paths.dshBin,
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      "43127",
    ]);
  });
});

describe("buildHarnessSpawnOptions", () => {
  it("builds win32 spawn options that preserve Path without mutating the input env", () => {
    // Given: a win32-style environment with Path, unrelated keys, and a leaked Electron marker
    const inputEnv: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\System32;C:\\Program Files",
      OTHER_VAR: "kept",
      ELECTRON_RUN_AS_NODE: "1",
    };
    const cwd = "C:\\Program Files\\DSH Flightdeck\\resources\\app";

    // When: the harness spawn options are built for that environment
    const options = buildHarnessSpawnOptions(inputEnv, cwd);

    // Then: the child process shape is fixed
    expect(options.cwd).toBe(cwd);
    expect(options.windowsHide).toBe(true);
    expect(options.stdio).toBe("pipe");

    // Then: env is a fresh copy that keeps Path and OTHER_VAR, sets NO_COLOR and DSH_HOME, and drops the Electron marker
    expect(options.env).not.toBe(inputEnv);
    expect(options.env["Path"]).toBe("C:\\Windows\\System32;C:\\Program Files");
    expect(options.env["OTHER_VAR"]).toBe("kept");
    expect(options.env["NO_COLOR"]).toBe("1");
    expect(options.env["DSH_HOME"]).toBe(cwd);
    expect(options.env["ELECTRON_RUN_AS_NODE"]).toBeUndefined();

    // Then: the input env is never mutated
    expect(inputEnv["ELECTRON_RUN_AS_NODE"]).toBe("1");
    expect(inputEnv["NO_COLOR"]).toBeUndefined();
    expect(inputEnv["DSH_HOME"]).toBeUndefined();
  });
  it("prepends launcher directories to a win32 Path without mutating the input env", () => {
    // Given: a win32-style environment and the tools directory the pnpm launcher lives in
    const inputEnv: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\System32;C:\\Program Files",
      ELECTRON_RUN_AS_NODE: "1",
    };
    const cwd = "C:\\Program Files\\DSH Flightdeck\\resources\\app";
    const toolsDir = "C:\\Users\\tester\\AppData\\Roaming\\DSH Flightdeck\\tools";

    // When: the harness spawn options are built with the tools directory
    // prepended under the win32 delimiter (injected for cross-platform tests;
    // production defaults to path.delimiter)
    const options = buildHarnessSpawnOptions(inputEnv, cwd, [toolsDir], ";");

    // Then: the child PATH is the launcher directory first, the original
    // Path second, under a single PATH key (Windows env keys are
    // case-insensitive; two competing keys would be ambiguous)
    expect(options.env["Path"]).toBeUndefined();
    expect(options.env["PATH"]).toBe(`${toolsDir};C:\\Windows\\System32;C:\\Program Files`);
    expect(options.env["NO_COLOR"]).toBe("1");
    expect(options.env["DSH_HOME"]).toBe(cwd);
    expect(options.env["ELECTRON_RUN_AS_NODE"]).toBeUndefined();

    // Then: the input env is never mutated
    expect(inputEnv["Path"]).toBe("C:\\Windows\\System32;C:\\Program Files");
    expect(inputEnv["PATH"]).toBeUndefined();
  });
});

describe("withPrependedPath", () => {
  it("merges a win32 Path key into a single PATH key", () => {
    // Given: a win32-style environment keyed with the OS-native Path casing
    const inputEnv: NodeJS.ProcessEnv = { Path: "C:\\Windows" };

    // When: a directory is prepended with the win32 delimiter
    const env = withPrependedPath(inputEnv, ["C:\\tools"], ";");

    // Then: exactly one PATH entry exists, launcher first, and the input is untouched
    expect(env["Path"]).toBeUndefined();
    expect(env["PATH"]).toBe("C:\\tools;C:\\Windows");
    expect(inputEnv["Path"]).toBe("C:\\Windows");
  });

  it("keeps an existing PATH key and appends the original value", () => {
    // Given: a POSIX-style environment with an existing PATH key
    const inputEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    // When: directories are prepended with the POSIX delimiter
    const env = withPrependedPath(inputEnv, ["/opt/tools", "/usr/local/bin"], ":");

    // Then: the new directories lead and the original PATH trails
    expect(env["PATH"]).toBe("/opt/tools:/usr/local/bin:/usr/bin:/bin");
  });

  it("returns an untouched copy for an empty directory list", () => {
    // Given: a win32-style environment and no directories to prepend
    const inputEnv: NodeJS.ProcessEnv = { Path: "C:\\Windows" };

    // When: the path is rebuilt with an empty list
    const env = withPrependedPath(inputEnv, [], ";");

    // Then: the copy keeps the native key casing and value
    expect(env).toEqual(inputEnv);
    expect(env).not.toBe(inputEnv);
  });
});

describe("formatExitCode", () => {
  it("formats an unsigned raw exit code with an uppercase hex marker", () => {
    // Given: a raw child exit status reported as an unsigned 32-bit integer
    // When: it is formatted for diagnostics
    const formatted = formatExitCode(4294930435);

    // Then: the message carries the exact uppercase hex marker
    expect(typeof formatted).toBe("string");
    expect(formatted).toContain("0xFFFF7003");
  });
});

describe("isReadyStatus", () => {
  it.each([200, 299])("accepts status %i as ready", (status) => {
    // Given: a 2xx HTTP status from the DSH origin
    // When: readiness is evaluated
    // Then: the status is ready
    expect(isReadyStatus(status)).toBe(true);
  });

  it.each([199, 300, 404])("rejects status %i as not ready", (status) => {
    // Given: a non-2xx HTTP status from the DSH origin
    // When: readiness is evaluated
    // Then: the status is not ready
    expect(isReadyStatus(status)).toBe(false);
  });
});

describe("reserveLoopbackPort", () => {
  it("reserves a concrete IPv4 loopback port that a real server can bind", async () => {
    // Given: no port has been reserved yet
    // When: reserveLoopbackPort() binds 127.0.0.1:0 and reads the assigned port
    const port = await reserveLoopbackPort();

    // Then: the reserved port is a concrete integer in the valid range
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(1);
    expect(port).toBeLessThanOrEqual(65_535);

    // Then: a real IPv4 loopback server can bind that exact port
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });

    // Then: the server closes cleanly
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });
});

interface LoopbackTestHarness {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

// Event-driven test harness: a real local node:http server on an ephemeral
// 127.0.0.1 port. Tests react to observed requests instead of sleeping.
async function startLoopbackTestHarness(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<LoopbackTestHarness> {
  const server = createHttpServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test harness server has no TCP address");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

describe("waitUntilReady", () => {
  it.each([
    "http://localhost:43127",
    "http://192.0.2.1:43127",
    "http://127.0.0.1:43127/path",
    "http://127.0.0.1:43127?query=true",
    "http://127.0.0.1:43127#fragment",
  ])("rejects non-exact IPv4 loopback origin %s before probing", async (origin) => {
    // Given: an invalid readiness origin and a signal already aborted before any probe
    const controller = new AbortController();
    controller.abort("must-not-probe");

    // When: readiness validates the origin
    const readiness = waitUntilReady(origin, controller.signal);

    // Then: the typed origin error wins before abort handling or network probing
    await expect(readiness).rejects.toBeInstanceOf(ReadinessOriginError);
  });

  it("resolves ready when the origin answers 2xx", async () => {
    // Given: a real local HTTP server that answers 200
    const harness = await startLoopbackTestHarness((_request, response) => {
      response.statusCode = 200;
      response.end();
    });

    try {
      // When: readiness is polled at that exact origin
      const result = await waitUntilReady(harness.origin, new AbortController().signal);

      // Then: the first probe already resolves ready
      expect(result.status).toBe("ready");
    } finally {
      await harness.close();
    }
  });

  it("keeps polling a non-2xx origin until the signal aborts, without sleeps", async () => {
    // Given: a real local HTTP server that answers 404 and an abort that is
    // driven by observed requests (event-driven, no sleeps)
    let requests = 0;
    const controller = new AbortController();
    const harness = await startLoopbackTestHarness((_request, response) => {
      requests += 1;
      response.statusCode = 404;
      response.end();
      if (requests >= 3) {
        controller.abort("test-abort");
      }
    });

    try {
      // When: readiness keeps polling the non-2xx origin
      const result = await waitUntilReady(harness.origin, controller.signal);

      // Then: polling continued until the abort, and the reason is the typed one
      expect(result).toEqual({ status: "aborted", reason: "test-abort" });
      expect(requests).toBeGreaterThanOrEqual(3);
    } finally {
      await harness.close();
    }
  });

  it("resolves aborted without probing when the signal is already aborted", async () => {
    // Given: a signal that is aborted before the first poll
    const controller = new AbortController();
    controller.abort("pre-aborted");

    // When: readiness is polled at an unreachable origin
    const result = await waitUntilReady("http://127.0.0.1:1", controller.signal);

    // Then: no request is attempted and the typed abort reason is returned
    expect(result).toEqual({ status: "aborted", reason: "pre-aborted" });
  });
});

describe("HarnessRuntime", () => {
  it("stops from idle deliberately and remains idempotent", async () => {
    // Given: a runtime that has never started a child process
    const runtime = new HarnessRuntime({
      paths: { nodeExecutable: "unused", dshBin: "unused", runtimeEntry: "unused", assetsDir: "unused" },
      launchDirectory: "unused",
      dshHome: "unused",
      logFile: "unused",
      platform: "darwin",
      env: {},
    });

    // When: stop is requested more than once
    const first = await runtime.stop();
    const second = await runtime.stop();

    // Then: both calls report the same deliberate, child-free exit
    expect(first).toEqual({ outcome: "exited", exitCode: null, deliberate: true });
    expect(second).toEqual(first);
  });

  it("does not restart or create runtime state after stop from idle", async () => {
    // Given: an idle runtime with deliberately unusable paths
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-stopped-"));
    const launchDirectory = join(root, "launch");
    const dshHome = join(root, "home");
    const logFile = join(root, "logs", "runtime.log");
    const phases: string[] = [];
    const runtime = new HarnessRuntime({
      paths: {
        nodeExecutable: join(root, "missing-node"),
        dshBin: join(root, "missing-dsh.js"),
        runtimeEntry: join(root, "missing-entry.mjs"),
        assetsDir: root,
      },
      launchDirectory,
      dshHome,
      logFile,
      platform: process.platform,
      env: {},
      onSnapshot: (snapshot) => phases.push(snapshot.phase),
    });

    try {
      // When: start is called after a deliberate idle stop
      const stopped = await runtime.stop();
      const restarted = await runtime.start();

      // Then: start preserves the stopped outcome and performs no startup side effects
      expect(restarted).toEqual(stopped);
      expect(phases).toEqual(["stopped"]);
      await expect(access(launchDirectory)).rejects.toThrow();
      await expect(access(dshHome)).rejects.toThrow();
      await expect(access(logFile)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not spawn when stopped during asynchronous pre-spawn setup", async () => {
    // Given: an idle runtime whose child paths are deliberately unusable
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-pre-spawn-stop-"));
    const logFile = join(root, "logs", "runtime.log");
    const phases: string[] = [];
    const runtime = new HarnessRuntime({
      paths: {
        nodeExecutable: join(root, "missing-node"),
        dshBin: join(root, "missing-dsh.js"),
        runtimeEntry: join(root, "missing-entry.mjs"),
        assetsDir: root,
      },
      launchDirectory: join(root, "launch"),
      dshHome: join(root, "home"),
      logFile,
      platform: process.platform,
      env: {},
      onSnapshot: (snapshot) => phases.push(snapshot.phase),
    });

    try {
      // When: stop takes the idle branch while start awaits directory setup
      const starting = runtime.start();
      const stopped = await runtime.stop();
      const outcome = await starting;

      // Then: startup preserves the deliberate exit and never reaches stream/spawn setup
      expect(outcome).toEqual(stopped);
      expect(phases).toEqual(["stopped"]);
      await expect(access(logFile)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let losing readiness mutate lifecycle after the child exits", async () => {
    // Given: a real Node child that exits before its reserved origin can become ready
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-runtime-"));
    const runtimeEntry = join(root, "runtime-entry.mjs");
    const dshBin = join(root, "dsh-bin.js");
    await Promise.all([writeFile(runtimeEntry, "process.exitCode = 17;\n"), writeFile(dshBin, "")]);
    const phases: string[] = [];
    const runtime = new HarnessRuntime({
      paths: { nodeExecutable: process.execPath, dshBin, runtimeEntry, assetsDir: root },
      launchDirectory: join(root, "launch"),
      dshHome: join(root, "home"),
      logFile: join(root, "logs", "runtime.log"),
      platform: process.platform,
      env: {},
      onSnapshot: (snapshot) => phases.push(snapshot.phase),
    });

    try {
      // When: child completion wins the startup race
      const outcome = await runtime.start();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: readiness never begins a late shutdown transition
      expect(outcome).toEqual({ outcome: "exited", exitCode: 17, deliberate: false });
      expect(phases).not.toContain("stopping");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
