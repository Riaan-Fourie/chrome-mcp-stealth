# Chrome MCP Stealth — Claude Instructions

## Overview
MCP server for stealth browser automation via Chrome DevTools Protocol. Connects to a real Chrome instance (not headless) with human-like interaction patterns to avoid bot detection.

## Project Structure
```
chrome-mcp/
├── index.js          # Full MCP server (single file)
├── package.json      # Dependencies: @modelcontextprotocol/sdk, playwright-core
├── .gitignore        # node_modules/
└── CLAUDE.md         # This file
```

## Commands
- `npm start` — run the server (requires Chrome with CDP running)
- `npm install` — install dependencies

## How It Works
- Connects to Chrome via CDP on `http://127.0.0.1:9222` (configurable via `CDP_ENDPOINT` env var)
- Chrome must be launched separately with `--remote-debugging-port=9222` and a non-default `--user-data-dir`
- Default mode: **stealth** (Bezier mouse, Gaussian typing, anti-detection patches)
- Fast mode available on request for non-protected domains

## Key Architecture

### Modes
- **Stealth** (default): human-like delays, Bezier mouse curves, scroll jitter, anti-detection JS patches
- **Fast**: instant actions, no delays — blocked on stealth-only domains

### Stealth-Only Domains
Defined in `STEALTH_ONLY_DOMAINS` set in `index.js`. These domains:
- Cannot be switched to fast mode
- Auto-enforce stealth on navigation
- Currently: `linkedin.com`, `www.linkedin.com`

To add a new domain: add it to the `STEALTH_ONLY_DOMAINS` Set near the top of `index.js`.

### Security Layers
1. Prompt injection scanner (20+ regex patterns)
2. Content sanitization (strips hidden elements)
3. Spotlighting (wraps external content in trust tags)
4. Domain blocking (cloud metadata endpoints)
5. Credential redaction in output
6. Sensitive domain warnings

## Do NOT
- Remove or weaken any security layers (injection scanner, credential redaction, domain blocking)
- Allow fast mode on stealth-only domains — the enforcement exists for a reason
- Hardcode credentials, API keys, or tokens anywhere in the codebase
- Add dependencies unless absolutely necessary — this is a single-file server by design

## Do
- Keep it as a single `index.js` file — no splitting into modules unless it gets unmanageable
- Test changes by running `node -e "import('./index.js').catch(e => { console.error(e); process.exit(1); }); setTimeout(() => { console.log('OK'); process.exit(0); }, 3000);"`
- Add new stealth-only domains to `STEALTH_ONLY_DOMAINS` when needed
- Add new sensitive/blocked domains to their respective Sets when needed
- Commit to this repo's own git (not Jarvis) — `repos/` is in Jarvis's `.gitignore`

## MCP Registration
Registered as `chrome-stealth` in Jarvis's `.mcp.json`:
```json
"chrome-stealth": {
  "command": "node",
  "args": ["/path/to/project/repos/chrome-mcp/index.js"],
  "env": { "CDP_ENDPOINT": "http://127.0.0.1:9222" }
}
```

## Tools (11)
| Tool | Purpose |
|------|---------|
| `chrome_set_mode` | Switch stealth/fast (fast blocked on protected domains) |
| `chrome_navigate` | Go to URL |
| `chrome_snapshot` | Accessibility tree of page (sanitized) |
| `chrome_screenshot` | PNG screenshot |
| `chrome_click` | Click element (Bezier in stealth) |
| `chrome_type` | Type text (Gaussian delays in stealth) |
| `chrome_tabs` | List/switch/create/close tabs |
| `chrome_evaluate` | Run JS in page (output redacted) |
| `chrome_wait` | Wait for selector or timeout |
| `chrome_scroll` | Scroll up/down (jittered in stealth) |
| `chrome_page_info` | Current URL, title, domain risk |
