/**
 * Shared contracts between the Electron main process and the DSH harness.
 * Single home for lifecycle timing values (plan section 5.2/5.3) and the
 * runtime state types the main wiring consumes.
 */

export const LIFECYCLE = {
  windowsStartupTimeoutMs: 120_000,
  defaultStartupTimeoutMs: 45_000,
  readinessPollIntervalMs: 250,
  httpRequestTimeoutMs: 1_000,
  stopGracePeriodMs: 4_000,
  progressLogIntervalMs: 10_000,
  maxRetainedLogLines: 200,
} as const;

export const LOOPBACK_HOST = "127.0.0.1" as const;

export type RuntimePhase = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface RuntimeSnapshot {
  readonly phase: RuntimePhase;
  readonly origin: string | null;
  readonly exitCode: number | null;
  readonly deliberateStop: boolean;
  readonly recentLogLines: readonly string[];
}

export type RuntimeOutcome =
  | { readonly outcome: "ready"; readonly origin: string; readonly port: number }
  | { readonly outcome: "exited"; readonly exitCode: number | null; readonly deliberate: boolean }
  | { readonly outcome: "startup-timeout"; readonly origin: string }
  | { readonly outcome: "spawn-failed"; readonly cause: string };
