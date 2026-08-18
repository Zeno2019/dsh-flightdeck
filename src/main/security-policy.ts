import { match } from "ts-pattern";

export interface AppSecurityPolicy {
  readonly harnessOrigin: string;
  readonly splashUrl: string;
}

export type NavigationDecision =
  | { readonly kind: "allow-in-app" }
  | { readonly kind: "open-external"; readonly url: string }
  | { readonly kind: "deny" };

export interface WindowPermissionRequest {
  readonly permission: string;
  readonly requestingUrl: string;
  readonly isMainFrame: boolean;
  readonly policy: AppSecurityPolicy;
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function isTrustedAppUrl(rawUrl: string, policy: AppSecurityPolicy): boolean {
  if (rawUrl === policy.splashUrl) return true;
  const url = parseUrl(rawUrl);
  return url !== null && url.origin === policy.harnessOrigin;
}

export function classifyNavigation(rawUrl: string, policy: AppSecurityPolicy): NavigationDecision {
  if (isTrustedAppUrl(rawUrl, policy)) return { kind: "allow-in-app" };
  return match(parseUrl(rawUrl)?.protocol)
    .with("http:", "https:", () => ({ kind: "open-external", url: rawUrl } as const))
    .otherwise(() => ({ kind: "deny" } as const));
}

export function canGrantWindowPermission(request: WindowPermissionRequest): boolean {
  return match(request)
    .with({ permission: "clipboard-sanitized-write", isMainFrame: true }, (r) => {
      const url = parseUrl(r.requestingUrl);
      return url !== null && url.origin === r.policy.harnessOrigin;
    })
    .otherwise(() => false);
}

export function isAbortedNavigationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return ("code" in error && error.code === "ERR_ABORTED") || ("errno" in error && error.errno === -3);
}