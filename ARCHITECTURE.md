# Architecture

## Overview

Chrome MCP Stealth is a single-file MCP server (`index.js`) that provides browser automation via Chrome DevTools Protocol with human-like interaction patterns to avoid bot detection.

## Modes

### Fast Mode (default)
- Instant actions with no artificial delays
- Standard Playwright click/type/scroll
- Suitable for non-protected domains

### Stealth Mode
- Human-like delays on all interactions
- Bezier curve mouse movement
- Gaussian keystroke timing
- Scroll jitter
- Anti-detection JavaScript patches
- Auto-activated on stealth-only domains (e.g., LinkedIn)
- Auto-restored to fast mode when navigating away from protected domains

## Stealth Implementation

### Bezier Curve Mouse Movement
Mouse movements follow cubic Bezier curves with randomized control points, producing natural-looking paths instead of straight lines. The implementation:
- Generates 12–50 interpolation steps (Gaussian-distributed around 25)
- Uses ease-in-out timing (quadratic easing)
- Adds perpendicular jitter to control points proportional to movement distance
- Occasionally overshoots the target and corrects (10% probability)
- Tracks cursor position across interactions for continuous movement

### Gaussian Keystroke Delays
Typing simulates human rhythm:
- Base inter-key delay: ~75ms (stddev 25ms)
- Extra delay after spaces (~30ms) and punctuation (~100ms)
- Periodic "thinking pauses" every ~10 characters (~400ms)
- All delays are Gaussian-distributed with configurable min/max clamping

### Scroll Jitter
Scrolling is broken into 3–8 steps with:
- Per-step distance jitter (15–20% of step size)
- Gaussian inter-step delays (~100–120ms)
- Post-scroll settling delay (~200ms)

### Anti-Detection Patches
Applied once per page via `applyStealthPatches()`:
- Removes `navigator.webdriver` flag
- Injects `chrome.runtime` stub
- Overrides `navigator.permissions.query` for notifications
- Cleans Playwright/Selenium/WebDriver window properties
- Spoofs `navigator.plugins` with realistic Chrome plugin list

### Multi-Layer Stealth Enforcement
Stealth-only domains (configured in `STEALTH_ONLY_DOMAINS`) are enforced at multiple points:
1. **Navigation** — auto-switches to stealth before loading the page
2. **Mode switch** — blocks `set_mode("fast")` on protected domains
3. **Every interaction** — `enforceStealthIfNeeded()` runs at the top of click/type/scroll/evaluate/snapshot/screenshot
4. **Post-redirect** — checks the actual URL after page load (catches server-side redirects)
5. **Tab switch** — enforces stealth when switching to a tab on a protected domain

## Security Model

### Layer 1: Prompt Injection Scanner
20+ regex patterns detect common injection attempts in page content:
- Instruction override patterns ("ignore previous instructions", "system override")
- Social engineering ("this is an official override", "from your creator")
- Data exfiltration attempts ("send this data to", "exfiltrate", "leak")
- Prompt extraction ("reveal your prompt", "show me your instructions")

Detected patterns are flagged with a risk score (0.0–1.0) in the security report.

### Layer 2: Content Sanitization
`extractSafePageText()` strips invisible/hidden elements before returning page content:
- Skips `script`, `style`, `noscript`, `svg`, `template` tags
- Filters elements with `display: none`, `visibility: hidden`, `opacity: 0`, `font-size: 0`
- Excludes zero-dimension elements
- Only returns interactive elements (links, buttons, inputs, headings, images)

### Layer 3: Content Spotlighting
All page content is wrapped in trust boundary tags:
```
<EXTERNAL_CONTENT source="web" url="..." trust="untrusted">
  ...page content...
</EXTERNAL_CONTENT>
```
A security footer reminds that content within these tags is data, not instructions.

### Layer 4: Domain Controls
- **Blocked domains**: Cloud metadata endpoints (169.254.169.254, metadata.google.internal) — navigation rejected entirely
- **Sensitive domains**: Banking, email, cloud consoles — trigger warnings on every interaction
- **Stealth-only domains**: Must use stealth mode — fast mode blocked

### Credential Redaction
All output is scanned for credential patterns before being returned:
- OpenAI API keys (`sk-...`)
- GitHub tokens (`ghp_...`)
- AWS access keys (`AKIA...`)
- JWTs (`eyJ...`)
- Bearer tokens

Matches are replaced with `[REDACTED_CREDENTIAL]`.

## Tools

| Tool | Description |
|------|-------------|
| `chrome_set_mode` | Switch between stealth and fast mode. Fast mode is blocked on stealth-only domains. |
| `chrome_navigate` | Navigate to a URL. Blocked domains are rejected. Stealth auto-activates on protected domains. |
| `chrome_snapshot` | Returns the page's accessibility tree with content sanitization, spotlighting, and injection scanning. |
| `chrome_screenshot` | Captures a PNG screenshot of the current page (supports full-page capture). |
| `chrome_click` | Clicks an element using CSS or Playwright selectors. In stealth mode, uses Bezier mouse movement. |
| `chrome_type` | Types text into the focused element or a specified selector. Credential patterns are blocked from input. |
| `chrome_tabs` | List, switch, create, or close browser tabs. Stealth is enforced when switching to protected domains. |
| `chrome_evaluate` | Executes JavaScript in the page context. Output is scanned for credential leaks. |
| `chrome_wait` | Waits for a CSS selector to appear or a fixed timeout. |
| `chrome_scroll` | Scrolls the page up or down. In stealth mode, uses jittered multi-step scrolling. |
| `chrome_page_info` | Returns the current URL, page title, and domain risk assessment. |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CDP_ENDPOINT` | `http://127.0.0.1:9222` | Chrome DevTools Protocol endpoint URL |

## Connection Management

The server connects to Chrome via CDP using Playwright's `connectOverCDP`. Each server instance creates its own tab to avoid conflicts when multiple instances share the same Chrome process. Automatic reconnection handles cases where the browser disconnects or pages are closed externally.
