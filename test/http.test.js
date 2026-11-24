// One server for every Claude session over HTTP (Jarvis #922): loopback only,
// web pages refused, and each session keeps its own tab and mode.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requestAllowed, parseHttpPort, sweepIdleSessions } from "../index.js";

const ENTRY = fileURLToPath(new URL("../index.js", import.meta.url));

const CDP = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";

async function cdpUp() {
  try { return (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

async function connect(port) {
  const client = new Client({ name: "test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await client.connect(transport);
  client.end = async () => { await transport.terminateSession().catch(() => {}); await client.close(); };
  return client;
}

async function chromeTitles() {
  return (await (await fetch(`${CDP}/json/list`)).json()).map((t) => t.title);
}

const text = (result) => result.content.map((c) => c.text).join("\n");

describe("who may talk to the server", () => {
  test("loopback Host only, on this port", () => {
    assert.equal(requestAllowed({ host: "127.0.0.1:3140" }, 3140), true);
    assert.equal(requestAllowed({ host: "localhost:3140" }, 3140), true);
    assert.equal(requestAllowed({ host: "evil.example:3140" }, 3140), false);
    assert.equal(requestAllowed({ host: "127.0.0.1:9999" }, 3140), false);
    assert.equal(requestAllowed({}, 3140), false);
  });

  test("any Origin but the server's own is a web page, and refused", () => {
    assert.equal(requestAllowed({ host: "127.0.0.1:3140", origin: "https://evil.example" }, 3140), false);
    assert.equal(requestAllowed({ host: "127.0.0.1:3140", origin: "null" }, 3140), false);
    assert.equal(requestAllowed({ host: "127.0.0.1:3140", origin: "http://127.0.0.1:3140" }, 3140), true);
  });

  test("the port comes only from --http, and must be a real one", () => {
    assert.equal(parseHttpPort([]), null);
    assert.equal(parseHttpPort(["--http", "3140"]), 3140);
    for (const bad of [["--http"], ["--http", "x"], ["--http", "80"], ["--http", "70000"]]) {
      assert.throws(() => parseHttpPort(bad));
    }
  });

  test("a session silent for a day is closed, a live one kept", () => {
    let closed = 0;
    const transport = { close: async () => { closed++; } };
    const now = Date.now();
    const sessions = new Map([["old", { transport, lastSeen: now - 25 * 3600e3 }], ["live", { transport, lastSeen: now - 60e3 }]]);
    sweepIdleSessions(sessions, now);
    assert.deepEqual([...sessions.keys()], ["live"]);
    assert.equal(closed, 1);
  });
});

describe("over HTTP, on a real port", () => {
  // The real entry point in a child process, as launchd runs it: this test
  // process then holds no Chrome connection and can exit.
  let child;
  const port = 31400 + Math.floor(Math.random() * 500);
  before(async () => {
    child = spawn(process.execPath, [ENTRY, "--http", String(port)], { stdio: ["ignore", "ignore", "pipe"] });
    await new Promise((resolve, reject) => {
      child.stderr.on("data", (d) => { if (String(d).includes("serving every session")) resolve(); });
      child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
  });
  after(() => child.kill());

  test("two sessions each list the same eleven tools", async () => {
    const [a, b] = [await connect(port), await connect(port)];
    try {
      const [ta, tb] = [await a.listTools(), await b.listTools()];
      assert.equal(ta.tools.length, 11);
      assert.deepEqual(ta.tools.map((t) => t.name), tb.tools.map((t) => t.name));
    } finally { await a.close(); await b.close(); }
  });

  test("a foreign Host, a web Origin, a wrong path and an unknown session are refused", async () => {
    const url = `http://127.0.0.1:${port}/mcp`;
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const web = await fetch(url, { method: "POST", body: init, headers: { ...headers, Origin: "https://evil.example" } });
    assert.equal(web.status, 403);
    const path = await fetch(`http://127.0.0.1:${port}/other`, { method: "POST", body: init, headers });
    assert.equal(path.status, 404);
    const unknown = await fetch(url, { method: "POST", body: init, headers: { ...headers, "Mcp-Session-Id": "nope" } });
    assert.equal(unknown.status, 404);
    const notInit = await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers });
    assert.equal(notInit.status, 400);
  });

  // Needs Chrome on CDP. Opens two blank background tabs and closes them.
  test("each session keeps its own tab and its own mode", async (t) => {
    if (!(await cdpUp())) return t.skip("Chrome CDP is not running");
    const [a, b] = [await connect(port), await connect(port)];
    try {
      const call = (c, name, args = {}) => c.callTool({ name, arguments: args });
      await call(a, "chrome_set_mode", { mode: "stealth" });
      await call(a, "chrome_navigate", { url: "data:text/html,<title>session-a-922</title>" });
      await call(b, "chrome_navigate", { url: "data:text/html,<title>session-b-922</title>" });
      const infoA = text(await call(a, "chrome_page_info"));
      const infoB = text(await call(b, "chrome_page_info"));
      assert.match(infoA, /Title: session-a-922/);
      assert.match(infoA, /Mode: stealth/);
      assert.match(infoB, /Title: session-b-922/);
      assert.match(infoB, /Mode: fast/);
      // Closing A's own tab leaves B's untouched, and A gets a fresh one.
      const tabsA = text(await call(a, "chrome_tabs", { action: "list" }));
      const own = tabsA.split("\n").find((l) => l.startsWith("-> "));
      const index = Number(own.match(/\[(\d+)\]/)[1]);
      await call(a, "chrome_tabs", { action: "close", index });
      assert.match(text(await call(b, "chrome_page_info")), /Title: session-b-922/);
      assert.doesNotMatch(text(await call(a, "chrome_page_info")), /session-[ab]-922/);
    } finally {
      for (const c of [a, b]) {
        const tabs = text(await c.callTool({ name: "chrome_tabs", arguments: { action: "list" } }));
        const own = tabs.split("\n").find((l) => l.startsWith("-> "));
        if (own) await c.callTool({ name: "chrome_tabs", arguments: { action: "close", index: Number(own.match(/\[(\d+)\]/)[1]) } });
        await c.close();
      }
    }
  });
  // Needs Chrome on CDP. Two sessions whose first calls race must still get
  // two tabs, and ending a session closes the tab it opened.
  test("sessions that start at the same moment get a tab each, closed when they end", async (t) => {
    if (!(await cdpUp())) return t.skip("Chrome CDP is not running");
    const clients = await Promise.all([1, 2, 3].map(() => connect(port)));
    try {
      await Promise.all(clients.map((c, i) =>
        c.callTool({ name: "chrome_navigate", arguments: { url: `data:text/html,<title>race-${i}-922</title>` } })));
      for (const [i, c] of clients.entries()) {
        assert.match(text(await c.callTool({ name: "chrome_page_info", arguments: {} })), new RegExp(`Title: race-${i}-922`));
      }
      assert.equal((await chromeTitles()).filter((x) => /race-\d-922/.test(x)).length, 3);
    } finally {
      for (const c of clients) await c.end();
    }
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await chromeTitles()).filter((x) => /race-\d-922/.test(x)).length, 0);
  });
});

