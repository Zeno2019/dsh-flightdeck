import { shell, type BrowserWindow } from "electron";
import { match } from "ts-pattern";
import {
  canGrantWindowPermission,
  classifyNavigation,
  isAbortedNavigationError,
  type AppSecurityPolicy,
} from "./security-policy.js";

function reportAsyncFailure(operation: string, error: unknown): void {
  const errorKind = error instanceof Error ? error.name : typeof error;
  console.error(`[main] ${operation} failed (${errorKind})`);
}

function loadTrustedUrl(window: BrowserWindow, url: string): void {
  void window.loadURL(url).catch((error: unknown) => {
    if (isAbortedNavigationError(error)) return;
    reportAsyncFailure("trusted navigation", error);
  });
}

function openExternalUrl(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    reportAsyncFailure("external navigation", error);
  });
}

function routeTopLevelNavigation(
  url: string,
  preventDefault: () => void,
  policy: AppSecurityPolicy,
): void {
  match(classifyNavigation(url, policy))
    .with({ kind: "allow-in-app" }, () => undefined)
    .with({ kind: "open-external" }, (decision) => {
      preventDefault();
      openExternalUrl(decision.url);
    })
    .with({ kind: "deny" }, () => preventDefault())
    .exhaustive();
}

export function secureWindow(window: BrowserWindow, policy: AppSecurityPolicy): void {
  const { webContents } = window;

  webContents.setWindowOpenHandler(({ url }) => {
    match(classifyNavigation(url, policy))
      .with({ kind: "allow-in-app" }, () => loadTrustedUrl(window, url))
      .with({ kind: "open-external" }, (decision) => openExternalUrl(decision.url))
      .with({ kind: "deny" }, () => undefined)
      .exhaustive();
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event) =>
    routeTopLevelNavigation(event.url, () => event.preventDefault(), policy),
  );

  webContents.on("will-redirect", (event) =>
    routeTopLevelNavigation(event.url, () => event.preventDefault(), policy),
  );

  webContents.on("will-attach-webview", (event) => event.preventDefault());

  webContents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    canGrantWindowPermission({
      permission,
      requestingUrl: requestingOrigin,
      isMainFrame: details.isMainFrame,
      policy,
    }),
  );
  webContents.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(
      canGrantWindowPermission({
        permission,
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
        policy,
      }),
    );
  });
}
