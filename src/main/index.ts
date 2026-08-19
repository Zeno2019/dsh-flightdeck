import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { match } from "ts-pattern";
import type { RuntimeOutcome, RuntimeSnapshot } from "../shared/contracts.js";
import { resolveRuntimePaths } from "./runtime-paths.js";
import { HarnessRuntime } from "./runtime.js";
import { seedWebProfile } from "./profile-seed.js";
import { secureWindow } from "./security.js";
import type { AppSecurityPolicy } from "./security-policy.js";

const APP_ID = "dev.zeno.dsh-flightdeck" as const;
const APP_TITLE = "DSH Flightdeck" as const;

// CI and portable use: point the whole per-user state tree (userData ->
// launch/, harness/, logs/) at an explicit directory before any Electron
// path is resolved. The packaged smoke uses this so the unpacked and the
// installed phases cannot collide on the same DSH_HOME.
const userDataOverride = process.env["DSH_FLIGHTDECK_USER_DATA"]?.trim();
if (userDataOverride !== undefined && userDataOverride !== "") {
  app.setPath("userData", userDataOverride);
}

type ShellPhase = "starting" | "ready" | "quitting";

let mainWindow: BrowserWindow | null = null;
let runtime: HarnessRuntime | null = null;
let shellPhase: ShellPhase = "starting";
let trustedHarnessOrigin = "";
let failureDisplayed = false;
let quitAllowed = false;
let shutdownPromise: Promise<void> | null = null;

function reportMainFailure(operation: string, error: unknown): void {
  const errorKind = error instanceof Error ? error.name : typeof error;
  console.error(`[main] ${operation} failed (${errorKind})`);
}

function showFailureAndQuit(message: string): void {
  if (failureDisplayed) return;
  failureDisplayed = true;
  shellPhase = "quitting";
  dialog.showErrorBox(APP_TITLE, message);
  app.quit();
}

function handleRuntimeSnapshot(snapshot: RuntimeSnapshot): void {
  if (snapshot.origin !== null) trustedHarnessOrigin = snapshot.origin;
  match({ shellPhase, runtimePhase: snapshot.phase })
    .with({ shellPhase: "ready", runtimePhase: "failed" }, () => {
      const exit = snapshot.exitCode === null ? "without an exit code" : `with exit code ${snapshot.exitCode}`;
      showFailureAndQuit(`The DSH runtime exited unexpectedly ${exit}.`);
    })
    .otherwise(() => undefined);
}

function handleRuntimeOutcome(window: BrowserWindow, outcome: RuntimeOutcome): Promise<void> {
  return match(outcome)
    .with({ outcome: "ready" }, async ({ origin }) => {
      if (shellPhase === "quitting") return;
      trustedHarnessOrigin = origin;
      shellPhase = "ready";
      await window.loadURL(origin);
      if (shellPhase === "ready") window.show();
    })
    .with({ outcome: "startup-timeout" }, () => {
      showFailureAndQuit("The DSH runtime did not become ready before the startup timeout.");
      return Promise.resolve();
    })
    .with({ outcome: "spawn-failed" }, () => {
      showFailureAndQuit("The bundled DSH runtime could not be started.");
      return Promise.resolve();
    })
    .with({ outcome: "exited", deliberate: false }, ({ exitCode }) => {
      const exit = exitCode === null ? "without an exit code" : `with exit code ${exitCode}`;
      showFailureAndQuit(`The DSH runtime exited unexpectedly ${exit}.`);
      return Promise.resolve();
    })
    .with({ outcome: "exited", deliberate: true }, () => Promise.resolve())
    .exhaustive();
}

async function startMainShell(): Promise<void> {
  Menu.setApplicationMenu(null);
  const paths = resolveRuntimePaths({
    mode: app.isPackaged ? "packaged" : "dev",
    platform: process.platform,
    appRoot: app.getAppPath(),
  });
  const splashUrl = pathToFileURL(join(paths.assetsDir, "splash.html")).href;
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: APP_TITLE,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  const securityPolicy: AppSecurityPolicy = {
    get harnessOrigin() {
      return trustedHarnessOrigin;
    },
    splashUrl,
  };
  secureWindow(window, securityPolicy);
  await window.loadURL(splashUrl);
  if (shellPhase === "quitting") return;
  window.show();

  const userData = app.getPath("userData");
  const dshHome = join(userData, "harness");

  // The packaged app ships a prepared web profile so the two approved DSH
  // plugins work without pnpm or network on the target machine. Seeding is
  // first-launch-only (the target manifest gates it) and a failure degrades
  // to DSH's own empty-template initialization instead of blocking startup.
  if (app.isPackaged) {
    try {
      const seeded = await seedWebProfile(dshHome, join(process.resourcesPath, "profile-web", "payload"));
      if (seeded) console.log("[desktop] seeded web profile from packaged resources");
    } catch (error) {
      reportMainFailure("web profile seed", error);
    }
  }

  const harnessRuntime = new HarnessRuntime({
    paths,
    launchDirectory: join(userData, "launch"),
    dshHome,
    logFile: join(userData, "logs", "harness.log"),
    platform: process.platform,
    env: process.env,
    onSnapshot: handleRuntimeSnapshot,
  });
  runtime = harnessRuntime;
  await handleRuntimeOutcome(window, await harnessRuntime.start());
}

function focusMainWindow(): void {
  const window = mainWindow;
  if (window === null) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  app.on("second-instance", focusMainWindow);
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    if (shutdownPromise !== null) return;
    shellPhase = "quitting";
    shutdownPromise = (async () => {
      const activeRuntime = runtime;
      if (activeRuntime !== null) await activeRuntime.stop();
      quitAllowed = true;
      app.quit();
    })();
    void shutdownPromise.catch((error: unknown) => {
      reportMainFailure("runtime shutdown", error);
      quitAllowed = true;
      app.exit(1);
    });
  });
  void app.whenReady().then(startMainShell).catch((error: unknown) => {
    reportMainFailure("application startup", error);
    if (shellPhase !== "quitting") showFailureAndQuit("DSH Flightdeck could not start.");
  });
}
