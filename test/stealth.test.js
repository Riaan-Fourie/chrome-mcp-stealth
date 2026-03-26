import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isForcedStealth,
  gaussian,
  gaussianDelay,
  cubicBezier,
  getAccessibilityTree,
  STEALTH_ONLY_DOMAINS,
} from "../index.js";

// ============================================================
// Forced Stealth Domain Detection
// ============================================================

describe("isForcedStealth", () => {
  it("returns true for linkedin.com", () => {
    assert.equal(isForcedStealth("https://linkedin.com/feed"), true);
  });

  it("returns true for www.linkedin.com", () => {
    assert.equal(isForcedStealth("https://www.linkedin.com/in/someone"), true);
  });

  it("returns true for LinkedIn subdomains", () => {
    assert.equal(isForcedStealth("https://jobs.linkedin.com/search"), true);
  });

  it("returns false for non-stealth domains", () => {
    assert.equal(isForcedStealth("https://google.com"), false);
    assert.equal(isForcedStealth("https://github.com"), false);
    assert.equal(isForcedStealth("https://example.com"), false);
  });

  it("returns false for domains containing 'linkedin' as substring", () => {
    assert.equal(isForcedStealth("https://notlinkedin.com"), false);
    assert.equal(isForcedStealth("https://fakelinkedin.com/phishing"), false);
  });

  it("handles invalid URLs gracefully", () => {
    assert.equal(isForcedStealth("not-a-url"), false);
    assert.equal(isForcedStealth(""), false);
  });
});

// ============================================================
// Gaussian Random Number Generation
// ============================================================

describe("gaussian", () => {
  it("generates numbers centered around the mean", () => {
    const samples = Array.from({ length: 1000 }, () => gaussian(100, 10));
    const avg = samples.reduce((a, b) => a + b) / samples.length;
    // With 1000 samples, average should be within ~2 stddev of mean
    assert.ok(avg > 90, `Mean ${avg} too low`);
    assert.ok(avg < 110, `Mean ${avg} too high`);
  });

  it("produces variation (not all the same value)", () => {
    const samples = Array.from({ length: 100 }, () => gaussian(50, 15));
    const unique = new Set(samples.map(Math.round));
    assert.ok(unique.size > 5, "Expected significant variation in gaussian output");
  });
});

describe("gaussianDelay", () => {
  it("respects minimum bound", () => {
    // With mean=10 and high stddev, some values would go negative without clamping
    const samples = Array.from({ length: 100 }, () => gaussianDelay(10, 100, 50));
    for (const s of samples) {
      assert.ok(s >= 50, `Delay ${s} is below minimum 50`);
    }
  });

  it("respects maximum bound", () => {
    const samples = Array.from({ length: 100 }, () => gaussianDelay(500, 100, 0, 600));
    for (const s of samples) {
      assert.ok(s <= 600, `Delay ${s} exceeds maximum 600`);
    }
  });

  it("returns integers", () => {
    const samples = Array.from({ length: 50 }, () => gaussianDelay(75, 25));
    for (const s of samples) {
      assert.equal(s, Math.floor(s), `Delay ${s} is not an integer`);
    }
  });

  it("defaults to min=50 when not specified", () => {
    const samples = Array.from({ length: 100 }, () => gaussianDelay(10, 100));
    for (const s of samples) {
      assert.ok(s >= 50, `Delay ${s} is below default minimum 50`);
    }
  });
});

// ============================================================
// Cubic Bezier
// ============================================================

describe("cubicBezier", () => {
  it("returns start point at t=0", () => {
    assert.equal(cubicBezier(0, 100, 200, 300, 400), 100);
  });

  it("returns end point at t=1", () => {
    assert.equal(cubicBezier(1, 100, 200, 300, 400), 400);
  });

  it("returns midpoint-ish at t=0.5", () => {
    const result = cubicBezier(0.5, 0, 0, 100, 100);
    // At t=0.5 with these control points, should be around 50
    assert.ok(result > 20 && result < 80, `Expected ~50, got ${result}`);
  });

  it("produces monotonic output for monotonic control points", () => {
    const points = [];
    for (let t = 0; t <= 1; t += 0.1) {
      points.push(cubicBezier(t, 0, 33, 66, 100));
    }
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i] >= points[i - 1] - 0.001, "Bezier should be monotonic for monotonic control points");
    }
  });

  it("handles negative control points", () => {
    const result = cubicBezier(0.5, -100, -50, 50, 100);
    assert.equal(typeof result, "number");
    assert.ok(!Number.isNaN(result));
  });
});

// ============================================================
// Accessibility Tree Formatting
// ============================================================

describe("getAccessibilityTree", () => {
  it("returns empty string for null input", () => {
    assert.equal(getAccessibilityTree(null), "");
  });

  it("formats a simple node", () => {
    const snapshot = { role: "button", name: "Submit" };
    const result = getAccessibilityTree(snapshot);
    assert.ok(result.includes('button "Submit"'));
  });

  it("handles nested children", () => {
    const snapshot = {
      role: "navigation",
      name: "Main",
      children: [
        { role: "link", name: "Home", url: "https://example.com" },
        { role: "link", name: "About" },
      ],
    };
    const result = getAccessibilityTree(snapshot);
    assert.ok(result.includes("navigation"));
    assert.ok(result.includes("Home"));
    assert.ok(result.includes("About"));
  });

  it("includes value when present", () => {
    const snapshot = { role: "textbox", name: "Email", value: "test@example.com" };
    const result = getAccessibilityTree(snapshot);
    assert.ok(result.includes("[value: test@example.com]"));
  });

  it("marks focused elements", () => {
    const snapshot = { role: "textbox", name: "Search", focused: true };
    const result = getAccessibilityTree(snapshot);
    assert.ok(result.includes("[focused]"));
  });

  it("skips generic/none roles without name", () => {
    const snapshot = { role: "none", children: [{ role: "button", name: "OK" }] };
    const result = getAccessibilityTree(snapshot);
    assert.ok(!result.includes("none"));
    assert.ok(result.includes("button"));
  });

  it("includes URLs for links", () => {
    const snapshot = { role: "link", name: "Home", url: "https://example.com" };
    const result = getAccessibilityTree(snapshot);
    assert.ok(result.includes("(https://example.com)"));
  });
});
