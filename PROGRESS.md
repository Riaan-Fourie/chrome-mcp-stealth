# Progress - chrome-mcp

Session log. One short entry per work session.

## 2026-11-24 - One server for every session, over HTTP (Jarvis #922)

- `node index.js --http <port>`: streamable HTTP on 127.0.0.1; one shared Chrome connection; each MCP
  session has its own `Server`, tab and mode (AsyncLocalStorage). Tabs open one at a time, matched by
  target id. Web pages refused by Host and Origin. A session's tab closes with it.
- ADR 0001. Tests: `test/http.test.js` (isolation and the tab race against the real Chrome on 9222).
- Witnessed PASS on Jarvis #922; the launchd daemon is in Jarvis `services/mcp-daemons/`, not installed yet.
