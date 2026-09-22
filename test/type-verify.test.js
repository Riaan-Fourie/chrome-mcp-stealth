// chrome_type must refuse to call a message typed when the field holds less than
// the full text, and chrome_click must refuse a Send while that is so (Jarvis #521).
// The case that started it: a LinkedIn message to Kieran Donnelly on 2026-09-20
// went out as "...just shout if th".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normaliseForCompare, typedTextLanded, isSendSelector } from "../index.js";

const KIERAN_DRAFT =
  "Hey Kieran - no stress, enjoy the leave.\n\nInvite sent for Thursday 15 October, 14:30 your side - just shout if that week doesn't suit once you're back.";
const KIERAN_SENT =
  "Hey Kieran - no stress, enjoy the leave.\nInvite sent for Thursday 15 October, 14:30 your side - just shout if th";

describe("typedTextLanded", () => {
  it("refuses the truncated Kieran message", () => {
    assert.equal(typedTextLanded(KIERAN_SENT, KIERAN_DRAFT), false);
  });

  it("refuses a single missing final character", () => {
    assert.equal(typedTextLanded("Friday works", "Friday works."), false);
  });

  it("accepts the full text whatever shape the line breaks took", () => {
    const asRendered = "Hey Kieran - no stress, enjoy the leave.\nInvite sent for Thursday 15 October, 14:30 your side - just shout if that week doesn't suit once you're back.";
    assert.equal(typedTextLanded(asRendered, KIERAN_DRAFT), true);
  });

  it("accepts non-breaking spaces and zero-width characters from rich editors", () => {
    assert.equal(typedTextLanded("Friday works.​", "Friday works."), true);
  });

  it("accepts the text when the field already held something before it", () => {
    assert.equal(typedTextLanded("Earlier line. Friday works.", "Friday works."), true);
  });

  it("refuses an empty field", () => {
    assert.equal(typedTextLanded("", "Friday works."), false);
  });

  it("treats typing nothing as landed", () => {
    assert.equal(typedTextLanded("", "   "), true);
  });
});

describe("normaliseForCompare", () => {
  it("collapses every run of whitespace to one space and trims", () => {
    assert.equal(normaliseForCompare("  a\n\n b\t c  "), "a b c");
  });

  it("copes with null and undefined", () => {
    assert.equal(normaliseForCompare(null), "");
    assert.equal(normaliseForCompare(undefined), "");
  });
});

describe("isSendSelector", () => {
  it("recognises the send selectors used on LinkedIn", () => {
    assert.equal(isSendSelector("button.msg-form__send-button"), true);
    assert.equal(isSendSelector("button:has-text('Send')"), true);
  });

  it("leaves other clicks alone", () => {
    assert.equal(isSendSelector("div.msg-form__contenteditable[role=textbox]"), false);
    assert.equal(isSendSelector("text=Continue"), false);
    assert.equal(isSendSelector(undefined), false);
  });
});
