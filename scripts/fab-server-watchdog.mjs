import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FAILURE_LIMIT = 3;
export const HEALTH_INTERVAL_MS = 60_000;
export const HEALTH_TIMEOUT_MS = 10_000;
export const START_GRACE_MS = 30_000;
export const STOP_GRACE_MS = 10_000;

export function nextWatchdogDecision(state, event) {
  if (event === "HEALTH_OK") {
    return { consecutiveFailures: 0, restartAttempt: 0, action: "WAIT" };
  }
  if (event === "CHILD_EXITED") {
    return {
      ...state,
      restartAttempt: state.restartAttempt + 1,
      action: "RESTART",
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    ...state,
    consecutiveFailures,
    action: consecutiveFailures >= FAILURE_LIMIT ? "RESTART" : "WAIT",
  };
}

export function restartDelayMs(attempt) {
  return Math.min(60_000, 1_000 * (2 ** Math.min(Math.max(0, attempt), 6)));
}

export function nextServerCommand(workdir, nodePath, port) {
  return {
    command: nodePath,
    args: [
      path.join(workdir, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "-p",
      String(port),
    ],
  };
}

function log(event, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[fab-watchdog] ${new Date().toISOString()} ${event}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkReady(url) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload.status === "READY",
      status: response.status,
      reason: typeof payload.reason === "string" ? payload.reason : "INVALID_RESPONSE",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: error instanceof Error ? error.name : "FETCH_FAILED",
    };
  }
}

function signalProcessGroup(pid, signal) {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

async function stopChild(child) {
  signalProcessGroup(child.pid, "SIGTERM");
  const exited = await Promise.race([
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(true)
      : new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(STOP_GRACE_MS).then(() => false),
  ]);
  if (!exited) {
    log("child-force-kill", `pid=${child.pid ?? "unknown"}`);
    signalProcessGroup(child.pid, "SIGKILL");
  }
}

async function superviseChild(child, readyUrl, stopping) {
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const waitOrExit = (ms) => Promise.race([sleep(ms).then(() => null), exitPromise]);

  const earlyExit = await waitOrExit(START_GRACE_MS);
  if (earlyExit) return { reason: "CHILD_EXITED", ...earlyExit };

  let state = { consecutiveFailures: 0, restartAttempt: 0 };
  while (!stopping()) {
    const health = await checkReady(readyUrl);
    state = nextWatchdogDecision(state, health.ok ? "HEALTH_OK" : "HEALTH_FAILED");
    log(
      health.ok ? "health-ok" : "health-failed",
      `status=${health.status} reason=${health.reason} failures=${state.consecutiveFailures}`,
    );
    if (state.action === "RESTART") {
      await stopChild(child);
      return { reason: "HEALTH_FAILED", code: child.exitCode, signal: child.signalCode };
    }
    const exited = await waitOrExit(HEALTH_INTERVAL_MS);
    if (exited) return { reason: "CHILD_EXITED", ...exited };
  }
  await stopChild(child);
  return { reason: "STOPPED", code: child.exitCode, signal: child.signalCode };
}

export async function runWatchdog(options = {}) {
  const workdir = path.resolve(
    options.workdir ?? process.env.FAB_WATCHDOG_WORKDIR ?? process.cwd(),
  );
  const port = Number(options.port ?? process.env.FAB_WATCHDOG_PORT ?? 3000);
  const nodePath = options.nodePath ?? process.execPath;
  const readyUrl = `http://127.0.0.1:${port}/api/health/ready`;
  let stopping = false;
  let restartAttempt = 0;
  let currentChild = null;

  const requestStop = () => {
    if (stopping) return;
    stopping = true;
    log("stop-requested");
    if (currentChild) void stopChild(currentChild);
  };
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);

  log("watchdog-start", `workdir=${workdir} port=${port}`);
  while (!stopping) {
    const server = nextServerCommand(workdir, nodePath, port);
    currentChild = spawn(server.command, server.args, {
      cwd: workdir,
      env: { ...process.env, FAB_WATCHDOG_MANAGED: "1" },
      stdio: "inherit",
      detached: true,
    });
    log("child-start", `pid=${currentChild.pid ?? "unknown"} attempt=${restartAttempt}`);
    const result = await superviseChild(currentChild, readyUrl, () => stopping);
    await stopChild(currentChild);
    currentChild = null;
    if (stopping || result.reason === "STOPPED") break;

    restartAttempt += 1;
    const delayMs = restartDelayMs(restartAttempt - 1);
    log(
      "child-restart-scheduled",
      `reason=${result.reason} code=${result.code ?? "null"} signal=${result.signal ?? "null"} delayMs=${delayMs}`,
    );
    await sleep(delayMs);
  }
  log("watchdog-stop");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runWatchdog().catch((error) => {
    console.error(
      `[fab-watchdog] ${new Date().toISOString()} fatal`,
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
