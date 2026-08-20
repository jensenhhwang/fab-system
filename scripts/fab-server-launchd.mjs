import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LABEL = "com.hwangjihun.fab-system.watchdog";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_PATH = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_LOG_PATH = "/tmp/fab-system-watchdog.log";

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderLaunchAgentPlist(input) {
  const watchdogPath = path.join(input.projectPath, "scripts", "fab-server-watchdog.mjs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(input.nodePath)}</string>
    <string>${xml(watchdogPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(input.projectPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FAB_WATCHDOG_WORKDIR</key>
    <string>${xml(input.projectPath)}</string>
    <key>FAB_WATCHDOG_PORT</key>
    <string>3000</string>
    <key>PATH</key>
    <string>${xml(input.pathValue)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(input.logPath)}</string>
</dict>
</plist>
`;
}

function launchctl(args, options = {}) {
  const result = spawnSync("/bin/launchctl", args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (!options.allowFailure && result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`launchctl ${args[0]} 실패${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function paths() {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  return {
    launchAgentsDir,
    plistPath: path.join(launchAgentsDir, `${LABEL}.plist`),
    domain: `gui/${process.getuid()}`,
    service: `gui/${process.getuid()}/${LABEL}`,
  };
}

function bootoutIfLoaded(service, domain, plistPath) {
  const status = launchctl(["print", service], { capture: true, allowFailure: true });
  if (status.status === 0) {
    launchctl(["bootout", domain, plistPath], { allowFailure: true });
  }
}

function install() {
  const p = paths();
  const projectPath = DEFAULT_PROJECT_PATH;
  mkdirSync(p.launchAgentsDir, { recursive: true });
  bootoutIfLoaded(p.service, p.domain, p.plistPath);
  const plist = renderLaunchAgentPlist({
    nodePath: process.execPath,
    projectPath,
    logPath: DEFAULT_LOG_PATH,
    pathValue: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  });
  writeFileSync(p.plistPath, plist, { encoding: "utf8", mode: 0o644 });
  launchctl(["bootstrap", p.domain, p.plistPath]);
  console.log(`FAB watchdog 설치 완료: ${p.plistPath}`);
  console.log(`로그: ${DEFAULT_LOG_PATH}`);
}

function start() {
  const p = paths();
  if (!existsSync(p.plistPath)) throw new Error("watchdog이 설치되지 않았습니다. ops:server:install을 먼저 실행하세요.");
  const status = launchctl(["print", p.service], { capture: true, allowFailure: true });
  if (status.status !== 0) launchctl(["bootstrap", p.domain, p.plistPath]);
  launchctl(["kickstart", "-k", p.service]);
  console.log("FAB watchdog 시작 요청 완료");
}

function stop() {
  const p = paths();
  bootoutIfLoaded(p.service, p.domain, p.plistPath);
  console.log("FAB watchdog 중지 완료");
}

function status() {
  const p = paths();
  const result = launchctl(["print", p.service], { capture: true, allowFailure: true });
  if (result.status !== 0) {
    console.log("FAB watchdog: STOPPED");
    process.exitCode = 1;
    return;
  }
  console.log(result.stdout.trim());
}

function uninstall() {
  const p = paths();
  bootoutIfLoaded(p.service, p.domain, p.plistPath);
  if (existsSync(p.plistPath)) unlinkSync(p.plistPath);
  console.log(`FAB watchdog 제거 완료: ${p.plistPath}`);
}

function main() {
  const command = process.argv[2];
  if (command === "install") return install();
  if (command === "start") return start();
  if (command === "stop") return stop();
  if (command === "status") return status();
  if (command === "uninstall") return uninstall();
  throw new Error("사용법: fab-server-launchd.mjs install|start|stop|status|uninstall");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
