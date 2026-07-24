import assert from "node:assert/strict";

async function main() {
  const base = "http://localhost:3000/api/twin/engine";
  // start
  const post = await fetch(base, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }) });
  assert.equal(post.status, 200, "POST start 200");
  const posted = await post.json();
  assert.equal(posted.status, "RUNNING", "start 후 RUNNING");
  // get
  const get = await fetch(base);
  assert.equal(get.status, 200, "GET 200");
  const data = await get.json();
  assert.ok(Array.isArray(data.materials), "materials 배열 반환");
  console.log("✅ twin api passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
