# Chrome MCP Stealth

MCP server for stealth browser automation via Chrome DevTools Protocol. Connects to a real Chrome instance with human-like interaction patterns (Bezier mouse curves, Gaussian typing delays, scroll jitter) to avoid bot detection.

## Why

Standard browser automation tools (Playwright, Puppeteer, Selenium) are trivially detected by modern anti-bot systems. Sites fingerprint mouse movements (straight lines, instant teleportation), typing patterns (uniform delays), and JavaScript properties (`navigator.webdriver`, missing plugins) to block automated access.

Chrome MCP Stealth solves this by layering human-like behavior on top of Playwright's CDP connection to a real Chrome instance — not a headless browser, not a fresh profile, but your actual browser with cookies, extensions, and history intact.

## Features

- **Stealth mode**: Bezier mouse movement, Gaussian keystroke delays, scroll jitter, anti-detection JS patches
- **Fast mode**: Instant actions with no delays — available on non-protected domains
- **Security**: 4-layer defense against prompt injection, data exfiltration, and credential leaks
- **Single file**: Entire server is one `index.js` file (~630 lines)

## How Stealth Works

**Mouse movement** follows cubic Bezier curves with randomized control points, producing natural arcs instead of straight lines. Each move uses 12–50 interpolation steps with ease-in-out timing and occasional overshoot corrections.

**Typing** uses Gaussian-distributed inter-key delays (~75ms mean), with extra pauses after punctuation and periodic "thinking pauses" every ~10 characters — mimicking human typing rhythm.

**Scrolling** is broken into jittered multi-step increments with settling delays, avoiding the instant jumps that flag automation.

**Anti-detection patches** remove `navigator.webdriver`, clean Playwright/Selenium artifacts from `window`, inject realistic `chrome.runtime` and plugin stubs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for full implementation details.

## Security Model

1. **Prompt injection scanner** — 20+ regex patterns detect instruction override attempts, social engineering, and data exfiltration commands in page content
2. **Content sanitization** — Hidden/invisible elements are stripped before returning page text, preventing injection via zero-size or off-screen elements
3. **Content spotlighting** — All page content is wrapped in `<EXTERNAL_CONTENT trust="untrusted">` tags with security footers
4. **Domain controls** — Cloud metadata endpoints are blocked entirely; banking/email domains trigger warnings; stealth-only domains enforce stealth mode

Additionally, all output is scanned for credential patterns (API keys, tokens, JWTs) and redacted before being returned.

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

LinkedIn (`linkedin.com`, `www.linkedin.com`) enforces stealth mode — fast mode is blocked. This is enforced at 5 layers: navigation, mode switch, every interaction, post-redirect, and tab switch.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `playwright-core` — Chrome DevTools Protocol connection

## License

MIT
