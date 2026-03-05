# Chrome MCP Stealth

MCP server for stealth browser automation via Chrome DevTools Protocol. Connects to a real Chrome instance with human-like interaction patterns (Bezier mouse curves, Gaussian typing delays, scroll jitter) to avoid bot detection.

Built for use with Claude Code and other MCP clients.

## Features

- **Stealth mode** (default): Bezier mouse movement, Gaussian keystroke delays, scroll jitter, anti-detection JS patches
- **Fast mode**: Instant actions, no delays — available on non-protected domains
- **Security**: Prompt injection scanner, content sanitization, credential redaction, domain blocking
- **Single file**: Entire server is one `index.js` file

## Tools (11)

| Tool | Purpose |
|------|---------|
| `chrome_set_mode` | Switch between stealth/fast mode |
| `chrome_navigate` | Navigate to URL |
| `chrome_snapshot` | Get sanitized accessibility tree |
| `chrome_screenshot` | Take PNG screenshot |
| `chrome_click` | Click element (Bezier mouse in stealth) |
| `chrome_type` | Type text (Gaussian delays in stealth) |
| `chrome_tabs` | List/switch/create/close tabs |
| `chrome_evaluate` | Run JS in page context (output redacted) |
| `chrome_wait` | Wait for selector or timeout |
| `chrome_scroll` | Scroll up/down (jittered in stealth) |
| `chrome_page_info` | Get current URL, title, domain risk |

## Setup

1. Launch Chrome with CDP:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --user-data-dir=~/.chrome-debug-profile
   ```

2. Install and run:
   ```bash
   npm install
   npm start
   ```

3. Register in your MCP config:
   ```json
   {
     "chrome-stealth": {
       "command": "node",
       "args": ["path/to/chrome-mcp/index.js"],
       "env": { "CDP_ENDPOINT": "http://127.0.0.1:9222" }
     }
   }
   ```

## Stealth-Only Domains

LinkedIn (`linkedin.com`, `www.linkedin.com`) enforces stealth mode — fast mode is blocked.

## Dependencies

- `@modelcontextprotocol/sdk`
- `playwright-core`
