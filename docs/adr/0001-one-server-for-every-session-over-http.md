# 0001 - One server for every session, over HTTP

**Status:** accepted (Jarvis #922).

## Context

Claude Code starts a stdio copy of every MCP server for each session it opens, used or not. On 23 Nov 2026
the MacBook (16 GB) ran 13 sessions, each with its own chrome-stealth process of about 89 MB, all driving the
same Chrome on CDP port 9222. Riaan asked for the servers that stay on to run once and be shared.

Each copy kept two things of its own: the tab it works in (`currentPage`) and the mode (`currentMode`, fast
or stealth). Shared naively, one session's navigate would move another session's tab, and one session's
stealth mode would apply to all.

## Decision

- **`node index.js --http <port>`** serves the same eleven tools over streamable HTTP at `/mcp`. Without the
  flag it runs on stdio as before.
- **The Chrome connection is shared; the tab and the mode belong to the MCP session.** Each HTTP session
  gets its own `Server` instance and its own state object, and every tool call runs inside that state
  (`AsyncLocalStorage`). A session opens its own background tab on its first call. A closed tab costs only
  its own session a new tab; the shared connection is rebuilt only when Chrome itself has gone. Closing your
  own tab leaves you with none until the next call, never with another session's.
- **127.0.0.1 only, and no token.** Any local process that can reach this port can already reach Chrome's
  CDP port, which can do more. What is refused is a web page: a request whose Host is not loopback on this
  port (DNS rebinding), or that carries any Origin other than the server's own.
- **A session silent for 24 hours is closed.** Its client gets 404 and starts a new session, as the MCP
  spec requires.

## Consequences

- One process for every session. The stealth-domain rules (LinkedIn) still run on every call, per session.
- Sessions can still see and select each other's tabs with `chrome_tabs`, as they could before, since every
  copy always drove the same Chrome.
- A tab a session opened stays open when the session ends, as it did with stdio.
- A crash of the one process drops every session's tool at once; launchd restarts it, and each client
  re-initialises.
