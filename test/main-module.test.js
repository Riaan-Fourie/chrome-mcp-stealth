// The main-module guard decides whether index.js connects the stdio transport.
// Every way it can get the answer wrong looks the same from outside: exit 0, empty
// stdout, empty stderr, CONNECTION_CLOSED at the client (Jarvis #494, #495). So
// these tests start the server the way .mcp.json does - a bash launcher that
// exports CDP_ENDPOINT and `exec node`s the server - demand a real `initialize`
// reply naming chrome-mcp, and then require the process to still be alive five
// seconds later. A guard returning false passes anything weaker in silence.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isEntryPoint } from "../index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const INDEX = path.join(REPO, "index.js");

// The liveness dwell: the server must still be running this long after replying.
const DWELL_MS = 5000;
const REPLY_TIMEOUT_MS = 15000;

// `os.tmpdir()` is itself symlinked on macOS (/var -> /private/var), which would
// make every "no symlink component" fixture a symlinked one. Resolve it up front.
const TMP_ROOT = mkdtempSync(path.join(realpathSync(tmpdir()), "chrome-mcp-495-"));

after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

// A standalone copy of the server: a real file on a real path, with node_modules
// reachable so the imports resolve. Copying (not symlinking) index.js is what makes
// the "no symlink component" fixtures honest.
function makeCopy(relDir) {
  const dir = path.join(TMP_ROOT, relDir);
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

// The shape of scripts/chrome-stealth-launcher.sh in the Jarvis repo, which is what
// .mcp.json actually runs: bash, an exported CDP_ENDPOINT, and `exec node <server>`.
// The real script hardcodes its server path, so a fixture needs its own copy.
function makeLauncher(name, entry) {
  const script = path.join(TMP_ROOT, `${name}.sh`);
  writeFileSync(script, [
    "#!/bin/bash",
    'CDP_PORT="${1:-9222}"',
    `MCP_SERVER=${JSON.stringify(entry)}`,
    'export CDP_ENDPOINT="http://127.0.0.1:${CDP_PORT}"',
    'exec node "${MCP_SERVER}"',
    "",
  ].join("\n"));
  chmodSync(script, 0o755);
  return script;
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

// Run a launcher command, send one MCP initialize, then hold the process for the
// dwell and report whether it was still alive at the end of it.
function launch({ command, args, dwellMs = DWELL_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: TMP_ROOT, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let reply = null;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      fn(value);
    };

    const timer = setTimeout(() => finish(reject, new Error(
      `no initialize reply within ${REPLY_TIMEOUT_MS}ms from ${command} ${args.join(" ")}\n` +
      `stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`,
    )), REPLY_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (reply) return;
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 1) continue;
        reply = message;
        clearTimeout(timer);
        setTimeout(() => finish(resolve, {
          serverInfo: reply.result?.serverInfo,
          aliveAfterDwell: child.exitCode === null && child.signalCode === null,
          stdout,
          stderr,
        }), dwellMs);
        return;
      }
    });

    child.on("error", (error) => finish(reject, error));
    child.on("exit", (code, signal) => {
      if (reply) {
        // Answered, then died inside the dwell window - not a working server.
        finish(resolve, { serverInfo: reply.result?.serverInfo, aliveAfterDwell: false, stdout, stderr });
        return;
      }
      finish(reject, new Error(
        `server exited (code ${code}, signal ${signal}) without replying - the silent ` +
        `failure of #494/#495.\ncommand: ${command} ${args.join(" ")}\n` +
        `stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`,
      ));
    });

    child.stdin.write(`${INITIALIZE}\n`);
  });
}

async function assertServes(entry, launcherName) {
  const launcher = makeLauncher(launcherName, entry);
  const { serverInfo, aliveAfterDwell } = await launch({
    command: "bash",
    args: [launcher, "9222", "shared"],
  });
  assert.ok(serverInfo, `expected serverInfo in the initialize reply for ${entry}`);
  assert.equal(serverInfo.name, "chrome-mcp");
  assert.equal(aliveAfterDwell, true,
    `server must still be running ${DWELL_MS}ms after replying (${entry})`);
}

// The fixtures. Built once, shared by the live cases; concurrency keeps six
// five-second dwells from serialising into half a minute.
const plainDir = makeCopy("plain");
const spacedDir = makeCopy("has space in it");
const deepDir = makeCopy(path.join("deep", "one", "two", "three"));
const plainLink = makeLink(plainDir, "link-to-plain");
const spacedLink = makeLink(spacedDir, "link-to-spaced");
const deepLink = makeLink(path.join(TMP_ROOT, "deep"), "link-to-deep");

describe("main-module guard - live launcher", { concurrency: true }, () => {
  it("serves through a symlinked directory", () =>
    assertServes(path.join(plainLink, "index.js"), "launcher-symlink"));

  it("serves through a symlinked ancestor three levels above index.js", () =>
    assertServes(path.join(deepLink, "one", "two", "three", "index.js"), "launcher-ancestor"));

  it("serves through a symlink whose real target contains a space", () =>
    assertServes(path.join(spacedLink, "index.js"), "launcher-spaced-symlink"));

  it("serves from a path with no symlink component, without a space", () =>
    assertServes(path.join(plainDir, "index.js"), "launcher-plain"));

  it("serves from a path with no symlink component, with a space", () =>
    assertServes(path.join(spacedDir, "index.js"), "launcher-spaced"));

  it("serves from this checkout's own path", () => assertServes(INDEX, "launcher-checkout"));

  it("serves when node is handed the directory rather than the file", () =>
    assertServes(plainLink, "launcher-dir-arg"));

  // The launcher .mcp.json actually names lives in the Jarvis repo, outside this
  // one, so CI will not have it. When it is there, run the real file with only its
  // hardcoded MCP_SERVER line repointed at a symlinked fixture.
  it("serves through the real Jarvis launcher script, repointed at a symlink", (t) => {
    const real = path.resolve(REPO, "..", "..", "scripts", "chrome-stealth-launcher.sh");
    if (!existsSync(real)) return t.skip(`not present: ${real}`);
    const entry = path.join(plainLink, "index.js");
    const copy = path.join(TMP_ROOT, "real-launcher.sh");
    const rewritten = readFileSync(real, "utf8")
      .replace(/^MCP_SERVER=.*$/m, `MCP_SERVER=${JSON.stringify(entry)}`);
    assert.match(rewritten, /^MCP_SERVER=/m, "expected an MCP_SERVER assignment to repoint");
    writeFileSync(copy, rewritten);
    chmodSync(copy, 0o755);
    return launch({ command: "bash", args: [copy, "9222", "shared"] }).then(({ serverInfo, aliveAfterDwell }) => {
      assert.equal(serverInfo?.name, "chrome-mcp");
      assert.equal(aliveAfterDwell, true);
    });
  });
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
    const moduleUrl = pathToFileURL(path.join(plainDir, "index.js")).href;
    assert.equal(isEntryPoint(moduleUrl, path.join(plainLink, "index.js")), true);
    // Still the entry point when the loader was told to keep the link path
    // (--preserve-symlinks-main), which the as-given comparison covers.
    const linkUrl = pathToFileURL(path.join(plainLink, "index.js")).href;
    assert.equal(isEntryPoint(linkUrl, path.join(plainLink, "index.js")), true);
  });

  it("matches through a symlinked ancestor three levels up", () => {
    const moduleUrl = pathToFileURL(path.join(deepDir, "index.js")).href;
    const viaLink = path.join(deepLink, "one", "two", "three", "index.js");
    assert.equal(isEntryPoint(moduleUrl, viaLink), true);
  });

  it("resolves a directory argument to the file node loads", () => {
    const moduleUrl = pathToFileURL(path.join(plainDir, "index.js")).href;
    assert.equal(isEntryPoint(moduleUrl, plainDir), true);
    assert.equal(isEntryPoint(moduleUrl, plainLink), true);
    assert.equal(isEntryPoint(moduleUrl, ".", plainDir), true);
  });

  it("reads as 'imported' when this suite imports index.js", () => {
    // argv[1] here is the test file the runner is executing, not index.js. This is
    // the observable behind "npm test terminates rather than hanging".
    assert.equal(isEntryPoint(pathToFileURL(INDEX).href, process.argv[1]), false);
  });
});
