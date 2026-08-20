import assert from "node:assert/strict";
import {
  LABEL,
  renderLaunchAgentPlist,
} from "./fab-server-launchd.mjs";

const xml = renderLaunchAgentPlist({
  nodePath: "/opt/node & tools/bin/node",
  projectPath: "/Fab/fab-system",
  logPath: "/tmp/fab-system-watchdog.log",
  pathValue: "/usr/bin:/bin",
});

assert.match(xml, new RegExp(LABEL.replaceAll(".", "\\.")));
assert.match(xml, /<string>\/opt\/node &amp; tools\/bin\/node<\/string>/);
assert.match(xml, /<string>\/Fab\/fab-system\/scripts\/fab-server-watchdog\.mjs<\/string>/);
assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
assert.doesNotMatch(xml, /DATABASE_URL|AUTH_SECRET|OPENAI_API_KEY/);

console.log("✅ FAB launchd plist 테스트 통과");
