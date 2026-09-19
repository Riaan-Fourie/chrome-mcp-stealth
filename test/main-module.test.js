// The main-module guard decides whether index.js connects the stdio transport.
// Every way it can get the answer wrong looks the same from outside: exit 0, empty
// stdout, empty stderr, CONNECTION_CLOSED at the client (Jarvis #494, #495). These
// tests therefore drive the real launcher and require a real `initialize` reply -
// a guard returning false silently would pass any assertion weaker than that.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isEntryPoint } from "../index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const INDEX = path.join(REPO, "index.js");

// `os.tmpdir()` is itself symlinked on macOS (/var -> /private/var), which would
// make every "not symlinked" fixture a symlinked one. Resolve it once, up front.
const TMP_ROOT = mkdtempSync(path.join(realpathSync(tmpdir()), "chrome-mcp-495-"));

after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

// A standalone copy of the server: a real file on a real path, with node_modules
// reachable so the imports resolve. Copying (not symlinking) index.js is what makes
// the "not symlinked" fixtures honest.
function makeCopy(dirName) {
  const dir = path.join(TMP_ROOT, dirName);
  mkdirSync(dir, { recursive: true });
  copyFileSync(INDEX, path.join(dir, "index.js"));
  copyFileSync(path.join(REPO, "package.json"), path.join(dir, "package.json"));
  symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
  return dir;
}

function makeLink(target, linkName) {
  const link = path.join(TMP_ROOT, linkName);
  symlinkSync(target, link, "dir");
  return link;
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "chrome-mcp-main-module-test", version: "0" },
  },
});

// Run `node <entry>`, send one MCP initialize, resolve with the reply and whether
// the process was still alive when it answered.
function handshake(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: TMP_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(
        `no initialize reply within 15s from ${entry}\n` +
        `stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`,
      ));
    }, 15000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 1) continue;
        finish(resolve, {
          serverInfo: message.result?.serverInfo,
          aliveWhenAnswered: child.exitCode === null,
          stderr,
        });
      }
    });

    child.on("error", (error) => finish(reject, error));
    child.on("exit", (code, signal) => finish(reject, new Error(
      `server exited (code ${code}, signal ${signal}) without replying - the silent ` +
      `failure of #494/#495.\nentry: ${entry}\n` +
      `stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`,
    )));

    child.stdin.write(`${INITIALIZE}\n`);
  });
}

async function assertServes(entry) {
  const { serverInfo, aliveWhenAnswered } = await handshake(entry);
  assert.ok(serverInfo, `expected serverInfo in the initialize reply from ${entry}`);
  assert.equal(serverInfo.name, "chrome-mcp");
  assert.equal(aliveWhenAnswered, true, "server must still be running after replying");
}

describe("main-module guard - live launcher", () => {
  // The four path shapes, each reached directly and through a symlink. The plain
  // cases are the regression guard: they pass before the #495 fix as well.
  const spacedDir = makeCopy("has space in it");
  const plainDir = makeCopy("nospace");
  const spacedLink = makeLink(spacedDir, "link-to-spaced");
  const plainLink = makeLink(plainDir, "link-to-plain");

  it("serves from a plain path", () => assertServes(path.join(plainDir, "index.js")));

  it("serves from a path holding a space", () =>
    assertServes(path.join(spacedDir, "index.js")));

  it("serves through a symlinked directory", () =>
    assertServes(path.join(plainLink, "index.js")));

  it("serves through a symlinked directory whose real target holds a space", () =>
    assertServes(path.join(spacedLink, "index.js")));

  it("serves when node is handed the directory rather than the file", () =>
    assertServes(plainLink));

  it("serves from this checkout's own path", () => assertServes(INDEX));
});

describe("main-module guard - isEntryPoint", () => {
  const url = pathToFileURL("/srv/chrome mcp/index.js").href;

  it("treats a missing argv[1] as the entry point (node --eval, REPL)", () => {
    assert.equal(isEntryPoint(url, undefined), true);
    assert.equal(isEntryPoint(url, ""), true);
  });

  it("matches the path as given, space and all", () => {
    assert.equal(isEntryPoint(url, "/srv/chrome mcp/index.js"), true);
  });

  it("matches a relative argv[1] against the cwd", () => {
    assert.equal(isEntryPoint(url, "index.js", "/srv/chrome mcp"), true);
  });

  it("does not match another file in the same directory", () => {
    assert.equal(isEntryPoint(url, "/srv/chrome mcp/other.js"), false);
  });

  it("does not match a path that no longer exists elsewhere", () => {
    assert.equal(isEntryPoint(url, "/srv/gone/index.js"), false);
  });

  it("matches through a symlinked directory", () => {
    const real = makeCopy("unit-real");
    const link = makeLink(real, "unit-link");
    const moduleUrl = pathToFileURL(path.join(real, "index.js")).href;
    assert.equal(isEntryPoint(moduleUrl, path.join(link, "index.js")), true);
    // Still the entry point when the loader was told to keep the link path.
    assert.equal(isEntryPoint(pathToFileURL(path.join(link, "index.js")).href,
      path.join(link, "index.js")), true);
  });

  it("resolves a directory argument to the file node loads", () => {
    const real = makeCopy("unit-dir");
    const link = makeLink(real, "unit-dir-link");
    const moduleUrl = pathToFileURL(path.join(real, "index.js")).href;
    assert.equal(isEntryPoint(moduleUrl, real), true);
    assert.equal(isEntryPoint(moduleUrl, link), true);
    assert.equal(isEntryPoint(moduleUrl, ".", real), true);
  });

  it("reads as 'imported' when this suite imports index.js", () => {
    // argv[1] here is the test file the runner is executing, not index.js.
    assert.equal(isEntryPoint(pathToFileURL(INDEX).href, process.argv[1]), false);
  });
});
