import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { dirname } from "node:path";
import { match } from "ts-pattern";
import { LIFECYCLE, LOOPBACK_HOST, type RuntimeOutcome, type RuntimePhase, type RuntimeSnapshot } from "../shared/contracts.js";
import { reserveLoopbackPort } from "./reserve-port.js";
import type { ResolvedRuntimePaths } from "./runtime-paths.js";

type HarnessSpawnOptions = { readonly cwd: string; readonly windowsHide: true; readonly stdio: "pipe"; readonly env: NodeJS.ProcessEnv };

export function buildHarnessArguments(port: number): readonly string[] { return ["web", "--host", LOOPBACK_HOST, "--port", String(port)]; }

export function endpointDiscoveryLine(origin: string): string { return `[desktop] endpoint ${origin}`; }

export function buildNodeArguments(runtimeEntry: string, dshBin: string, harnessArgs: readonly string[]): readonly string[] {
  return ["--expose-internals", runtimeEntry, dshBin, ...harnessArgs];
}

export function buildHarnessSpawnOptions(inputEnv: NodeJS.ProcessEnv, cwd: string): HarnessSpawnOptions {
  const env: NodeJS.ProcessEnv = { ...inputEnv, NO_COLOR: "1", DSH_HOME: cwd };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { cwd, windowsHide: true, stdio: "pipe", env };
}

export function formatExitCode(rawExitCode: number): string { return `0x${(rawExitCode >>> 0).toString(16).toUpperCase().padStart(8, "0")}`; }

export function isReadyStatus(status: number): boolean { return status >= 200 && status <= 299; }

export type ReadinessResult = { readonly status: "ready" } | { readonly status: "aborted"; readonly reason: string };

export class ReadinessOriginError extends Error { readonly name = "ReadinessOriginError"; }

export async function waitUntilReady(origin: string, signal: AbortSignal): Promise<ReadinessResult> {
  const url = new URL(origin);
  const isExactOrigin = url.pathname === "/" && url.search === "" && url.hash === "";
  const isLoopback = url.hostname === LOOPBACK_HOST && url.port !== "";
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (!isExactOrigin || !isLoopback || !isHttp || url.username !== "" || url.password !== "") {
    throw new ReadinessOriginError(`readiness requires an exact loopback origin: ${origin}`);
  }
  for (;;) {
    if (signal.aborted) return { status: "aborted", reason: abortReason(signal) };
    if (await probeOrigin(url, signal)) return { status: "ready" };
    if (!(await waitForNextProbe(signal))) return { status: "aborted", reason: abortReason(signal) };
  }
}

function probeOrigin(url: URL, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const onResponse = (response: http.IncomingMessage): void => {
      response.resume();
      resolve(isReadyStatus(response.statusCode ?? 0));
    };
    const options = { signal, timeout: LIFECYCLE.httpRequestTimeoutMs };
    const request = url.protocol === "https:" ? https.get(url, options, onResponse) : http.get(url, options, onResponse);
    request.once("error", () => resolve(false));
    request.once("timeout", () => { request.destroy(); resolve(false); });
  });
}

function waitForNextProbe(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = (): void => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(true); }, LIFECYCLE.readinessPollIntervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): string { const reason: unknown = signal.reason; return reason instanceof Error ? reason.message : String(reason); }

export interface HarnessRuntimeConfig {
  readonly paths: ResolvedRuntimePaths; readonly launchDirectory: string; readonly dshHome: string;
  readonly logFile: string; readonly platform: NodeJS.Platform; readonly env: NodeJS.ProcessEnv;
  readonly onSnapshot?: (snapshot: RuntimeSnapshot) => void;
}

export class HarnessRuntime {
  private phase: RuntimePhase = "idle"; private child: ChildProcess | null = null;
  private completion: Promise<RuntimeOutcome> | null = null; private stopPromise: Promise<RuntimeOutcome> | null = null;
  private exitCode: number | null = null; private deliberateStop = false; private origin: string | null = null;
  private logStream: WriteStream | null = null; private pendingLine = ""; private stopRequested = false;
  private readonly recentLogLines: string[] = [];

  constructor(private readonly config: HarnessRuntimeConfig) {}

  async start(): Promise<RuntimeOutcome> {
    if (this.stopRequested) return this.exitOutcome();
    await Promise.all([
      mkdir(this.config.launchDirectory, { recursive: true }),
      mkdir(this.config.dshHome, { recursive: true }),
      mkdir(dirname(this.config.logFile), { recursive: true }),
    ]);
    if (this.stopRequested) return this.exitOutcome();
    const port = await reserveLoopbackPort();
    if (this.stopRequested) return this.exitOutcome();
    const origin = `http://${LOOPBACK_HOST}:${port}`;
    this.origin = origin;
    this.logStream = createWriteStream(this.config.logFile, { flags: "a" });
    const baseOptions = buildHarnessSpawnOptions(this.config.env, this.config.launchDirectory);
    const child = spawn(
      this.config.paths.nodeExecutable,
      buildNodeArguments(this.config.paths.runtimeEntry, this.config.paths.dshBin, buildHarnessArguments(port)),
      { ...baseOptions, env: { ...baseOptions.env, DSH_HOME: this.config.dshHome } },
    );
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.captureLogChunk(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.captureLogChunk(chunk));
    this.completion = this.observeCompletion(child);
    this.setPhase("starting");
    const discovery = endpointDiscoveryLine(origin);
    console.log(discovery);
    this.writeLogLine(discovery);
    const controller = new AbortController();
    const timeoutMs = this.config.platform === "win32" ? LIFECYCLE.windowsStartupTimeoutMs : LIFECYCLE.defaultStartupTimeoutMs;
    const startupTimer = setTimeout(() => controller.abort("startup-timeout"), timeoutMs);
    startupTimer.unref();
    const race = await Promise.race([
      waitUntilReady(origin, controller.signal).then((readiness) => ({ winner: "readiness", readiness } as const)),
      this.completion.then((outcome) => ({ winner: "child", outcome } as const)),
    ]);
    clearTimeout(startupTimer);
    if (race.winner === "child") { controller.abort("child-completed"); return race.outcome; }
    if (race.readiness.status === "ready") { this.setPhase("ready"); return { outcome: "ready", origin, port }; }
    if (race.readiness.reason === "startup-timeout") { this.stopPromise ??= this.terminate(false); await this.stopPromise; return { outcome: "startup-timeout", origin }; }
    return await this.completion;
  }

  stop(): Promise<RuntimeOutcome> {
    this.stopRequested = true;
    return match(this.phase)
      .with("idle", () => this.finishWithoutChild())
      .with("starting", "ready", () => {
        this.stopPromise ??= this.terminate(true);
        return this.stopPromise;
      })
      .with("stopping", () => this.stopPromise ?? Promise.resolve(this.exitOutcome()))
      .with("stopped", "failed", () => Promise.resolve(this.exitOutcome()))
      .exhaustive();
  }

  private async terminate(deliberate: boolean): Promise<RuntimeOutcome> {
    this.deliberateStop = deliberate;
    this.setPhase("stopping");
    if (this.child === null || this.completion === null) return this.finishWithoutChild();
    this.child.kill("SIGTERM");
    let exited = await this.exitWithin(this.completion, LIFECYCLE.stopGracePeriodMs);
    if (!exited) {
      await this.forceKill(this.child);
      exited = await this.exitWithin(this.completion, LIFECYCLE.stopGracePeriodMs);
    }
    return exited ? await this.completion : this.exitOutcome();
  }

  private observeCompletion(child: ChildProcess): Promise<RuntimeOutcome> {
    return new Promise((resolve) => {
      let completed = false;
      const finish = (outcome: RuntimeOutcome): void => {
        if (completed) return;
        completed = true;
        this.finishChildLog();
        this.setPhase(this.deliberateStop ? "stopped" : "failed");
        resolve(outcome);
      };
      child.once("error", (error: Error) => {
        this.writeLogLine(`failed to spawn dsh: ${error.message}`);
        finish({ outcome: "spawn-failed", cause: error.message });
      });
      child.once("exit", (code) => {
        this.exitCode = code;
        if (!this.deliberateStop) this.writeLogLine(`dsh exited unexpectedly (code ${code === null ? "null" : formatExitCode(code)})`);
        finish(this.exitOutcome());
      });
    });
  }

  private exitWithin(completion: Promise<RuntimeOutcome>, milliseconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), milliseconds);
      completion.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  private async forceKill(child: ChildProcess): Promise<void> {
    if (this.config.platform === "win32" && child.pid !== undefined) {
      const succeeded = await new Promise<boolean>((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => resolve(false)); killer.once("close", (code) => resolve(code === 0));
      });
      if (!succeeded) child.kill("SIGKILL");
      return;
    }
    child.kill("SIGKILL");
  }

  private finishWithoutChild(): Promise<RuntimeOutcome> { this.stopRequested = true; this.deliberateStop = true; this.setPhase("stopped"); return Promise.resolve(this.exitOutcome()); }

  private exitOutcome(): RuntimeOutcome { return { outcome: "exited", exitCode: this.exitCode, deliberate: this.deliberateStop }; }

  private captureLogChunk(chunk: Buffer): void {
    this.logStream?.write(chunk);
    this.pendingLine += chunk.toString("utf8");
    const lines = this.pendingLine.split("\n");
    this.pendingLine = lines.pop() ?? "";
    for (const line of lines) this.pushLogLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  }

  private writeLogLine(line: string): void { this.logStream?.write(`${line}\n`); this.pushLogLine(line); }

  private pushLogLine(line: string): void {
    if (line === "") return;
    this.recentLogLines.push(line);
    const overflow = this.recentLogLines.length - LIFECYCLE.maxRetainedLogLines;
    if (overflow > 0) this.recentLogLines.splice(0, overflow);
  }

  private finishChildLog(): void {
    if (this.pendingLine !== "") this.pushLogLine(this.pendingLine);
    this.pendingLine = "";
    this.logStream?.end();
    this.logStream = null;
  }

  private setPhase(phase: RuntimePhase): void {
    this.phase = phase;
    this.config.onSnapshot?.({ phase, origin: this.origin, exitCode: this.exitCode,
      deliberateStop: this.deliberateStop, recentLogLines: [...this.recentLogLines] });
  }
}
