// RED specification for the pure exact-origin security policy (plan sections 3.4 and 6.2).
// The imports below do not exist yet, so the suite fails to resolve until
// src/main/security-policy.ts implements exactly the public interfaces pinned here.
// The implementation is expected to use ts-pattern: .exhaustive() for the closed
// classification/permission unions, .otherwise() only for the intentional default-deny
// branches on open URL input, and never .run().

import { describe, expect, it } from "vitest";
import {
  canGrantWindowPermission,
  classifyNavigation,
  isAbortedNavigationError,
  isTrustedAppUrl,
} from "../src/main/security-policy.js";

// Given: the fixed deployment origins the policy must distinguish
const policy = {
  harnessOrigin: "http://127.0.0.1:43127",
  splashUrl: "file:///Applications/DSH%20Flightdeck/resources/splash.html",
} as const;

describe("isTrustedAppUrl", () => {
  it.each([
    "http://127.0.0.1:43127",
    "http://127.0.0.1:43127/",
    "http://127.0.0.1:43127/some/path",
    "http://127.0.0.1:43127/?refresh=1",
    "http://127.0.0.1:43127/#section",
  ])("trusts the exact harness origin: %s", (rawUrl) => {
    // Given: a URL on the exact harness origin, with or without path, query, or hash
    // When: it is evaluated against the policy
    // Then: it is trusted in-app
    expect(isTrustedAppUrl(rawUrl, policy)).toBe(true);
  });

  it.each([
    "http://localhost:43127",
    "http://127.0.0.1:43128",
    "https://127.0.0.1:43127",
    "http://127.0.0.1:43127.evil.example",
    "http://example.com",
    "https://example.com/path",
    "javascript:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "not a url",
  ])("rejects anything outside the exact origin: %s", (rawUrl) => {
    // Given: a host alias, another port, an https loopback, an external URL, a non-http scheme, or a malformed URL
    // When: it is evaluated against the policy
    // Then: it is not trusted in-app
    expect(isTrustedAppUrl(rawUrl, policy)).toBe(false);
  });

  it("trusts the exact splash file URL", () => {
    // Given: the packaged splash page URL
    // When: it is evaluated against the policy
    // Then: it is trusted in-app
    expect(isTrustedAppUrl(policy.splashUrl, policy)).toBe(true);
  });

  it.each([
    "file:///Applications/DSH%20Flightdeck/resources/other.html",
    "file:///Applications/DSH%20Flightdeck/splash.html",
    "file:///etc/passwd",
    "file:///Applications/DSH%20Flightdeck/resources/splash.html?x=1",
  ])("rejects any other file URL: %s", (rawUrl) => {
    // Given: a file URL that differs from the exact splash URL
    // When: it is evaluated against the policy
    // Then: it is not trusted in-app
    expect(isTrustedAppUrl(rawUrl, policy)).toBe(false);
  });
});

describe("classifyNavigation", () => {
  it.each([
    "http://127.0.0.1:43127/",
    "http://127.0.0.1:43127/workspace",
    policy.splashUrl,
  ])("allows in-app navigation to %s", (rawUrl) => {
    // Given: the exact harness origin or the exact splash URL
    // When: the navigation is classified
    // Then: it stays inside the application window
    expect(classifyNavigation(rawUrl, policy)).toEqual({ kind: "allow-in-app" });
  });

  it.each([
    "http://example.com/",
    "https://example.com/path?tab=1#top",
    "https://example.com:8443/x",
  ])("opens external HTTP(S) through the shell, preserving the URL: %s", (rawUrl) => {
    // Given: an external HTTP or HTTPS URL in canonical form
    // When: the navigation is classified
    // Then: it opens externally with the exact URL preserved
    expect(classifyNavigation(rawUrl, policy)).toEqual({ kind: "open-external", url: rawUrl });
  });

  it.each([
    "mailto:someone@example.com",
    "javascript:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "file:///Applications/DSH%20Flightdeck/resources/other.html",
    "not a url",
  ])("denies unsupported or malformed navigation: %s", (rawUrl) => {
    // Given: a non-HTTP(S) scheme or a malformed URL
    // When: the navigation is classified
    // Then: it is denied
    expect(classifyNavigation(rawUrl, policy)).toEqual({ kind: "deny" });
  });
});

describe("canGrantWindowPermission", () => {
  it("grants clipboard-sanitized-write from the exact harness origin in the main frame", () => {
    // Given: a clipboard-sanitized-write request from the exact harness origin in the main frame
    // When: the permission is evaluated against the policy
    // Then: it is granted
    expect(
      canGrantWindowPermission({
        permission: "clipboard-sanitized-write",
        requestingUrl: policy.harnessOrigin,
        isMainFrame: true,
        policy,
      }),
    ).toBe(true);
  });

  it.each([
    { permission: "clipboard-sanitized-write", requestingUrl: "http://localhost:43127", isMainFrame: true },
    { permission: "clipboard-sanitized-write", requestingUrl: "http://127.0.0.1:43128", isMainFrame: true },
    { permission: "clipboard-sanitized-write", requestingUrl: "https://example.com", isMainFrame: true },
    { permission: "clipboard-sanitized-write", requestingUrl: policy.splashUrl, isMainFrame: true },
    { permission: "clipboard-sanitized-write", requestingUrl: policy.harnessOrigin, isMainFrame: false },
    { permission: "clipboard-write", requestingUrl: policy.harnessOrigin, isMainFrame: true },
    { permission: "clipboard-read", requestingUrl: policy.harnessOrigin, isMainFrame: true },
    { permission: "notifications", requestingUrl: policy.harnessOrigin, isMainFrame: true },
    { permission: "geolocation", requestingUrl: policy.harnessOrigin, isMainFrame: true },
  ])(
    "denies $permission from $requestingUrl (mainFrame=$isMainFrame)",
    ({ permission, requestingUrl, isMainFrame }) => {
      // Given: a request that is not clipboard-sanitized-write from the exact harness origin in the main frame
      // When: the permission is evaluated against the policy
      // Then: it is denied
      expect(canGrantWindowPermission({ permission, requestingUrl, isMainFrame, policy })).toBe(false);
    },
  );
});

describe("isAbortedNavigationError", () => {
  it.each([{ code: "ERR_ABORTED" }, { errno: -3 }, { code: "ERR_ABORTED", errno: -3 }])(
    "recognizes an aborted navigation error: %o",
    (error) => {
      // Given: an error carrying the abort markers (code ERR_ABORTED and/or errno -3)
      // When: the unknown value is classified
      // Then: it is an aborted navigation error
      expect(isAbortedNavigationError(error)).toBe(true);
    },
  );

  it.each([{ code: "ERR_CONNECTION_REFUSED" }, new Error("boom"), null, "ERR_ABORTED"])(
    "does not recognize %o as an aborted navigation error",
    (error) => {
      // Given: a value without the abort markers, including a bare string and null
      // When: the unknown value is classified
      // Then: it is not an aborted navigation error
      expect(isAbortedNavigationError(error)).toBe(false);
    },
  );
});
