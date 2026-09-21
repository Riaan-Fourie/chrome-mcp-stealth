#!/usr/bin/env python3
"""Witness gate (Jarvis #510).

Reads the PR body on stdin, reads WITNESS_GATE_LABELS_JSON from the env.
Exit 0 allows the merge, exit 1 blocks it.

The gate blocks on a marker, `<!-- witness: pending -->`, which the pull request
template ships in every new PR. A PR therefore starts blocked, and the author
removes the marker once a separate session has witnessed the work.

A short phrase list is a backstop only, because `gh pr create --body ...` skips
the template. It holds hedged, unambiguous wording. Ordinary English such as
"do not merge", "uncertified" or "not witnessed" is deliberately not matched:
those wrongly blocked normal pull requests in an earlier version.

The exemption is a label, never body text, so that writing about the token
cannot switch the gate off.

Normalisation exists because several renderings of the same visible phrase used
to slip through: non-breaking space, soft hyphen, zero-width characters, HTML
entities and inline tags. Two of those arrive by accident from copy-paste.

Written in Python rather than shell: the first version used a pipeline as a
condition under `set -o pipefail`, where grep -q exits early, printf takes
SIGPIPE and the pipeline reports 141, so the check silently passed on bodies
above roughly 61.5KB. Reading stdin to completion removes that whole class.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import unicodedata

MARKER = "<!-- witness: pending -->"
EXEMPT_LABEL = "witness-gate-exempt"

# The marker is an HTML comment, so a mangled one is INVISIBLE in the rendered
# description: the author sees nothing and believes they deleted it, while a
# strict match sees nothing either and lets the PR through. Six spellings were
# found rendering invisible yet passing - no inner spaces, no space after the
# colon, a space before it, a trailing full stop, the HTML5 `--!>` close, and a
# left-to-right mark inside. Match the shape, not one exact string.
MARKER_RE = re.compile(r"<!--\s*witness\s*:\s*pending\s*[.!?]?\s*--!?>", re.IGNORECASE)

# Hedged and specific. Nothing here is ordinary English a normal PR would use.
PHRASES = (
    "not yet witnessed",
    "not yet certified",
    "awaiting witness",
    "witness pending",
)

# Zero-width, soft hyphen, and the directional marks and isolates, which are
# invisible but split a match. A soft hyphen or non-breaking space arrives by
# accident from copy-paste, so this is not only about deliberate evasion.
ZERO_WIDTH = dict.fromkeys(
    map(ord, "​‌‍‎‏⁠﻿­⁦⁧⁨⁩"),
    None,
)


def _fold(text: str, tags: str | None = " ") -> str:
    text = html.unescape(text)          # &nbsp; &lt;span&gt; and friends
    text = text.translate(ZERO_WIDTH)   # zero-width and soft hyphen
    text = unicodedata.normalize("NFKC", text)
    if tags is not None:
        text = re.sub(r"<[^>]*>", tags, text)
    text = re.sub(r"[*_`~]", "", text)        # markdown emphasis
    text = re.sub(r"\s+", " ", text)          # folds newlines, NBSP, tabs
    return text.casefold().strip()


def normalise(text: str) -> list[str]:
    """Foldings of a PR body to match phrases against.

    An inline tag is dropped two ways, because neither alone is safe. Replacing
    `<span>` with a space leaves "wit nessed" for a phrase split mid-word;
    replacing it with nothing would weld "foo<br>bar" into one word. Matching
    against both fails closed, which is the safe direction here.
    """
    return [_fold(text, " "), _fold(text, "")]


def marker_present(body: str) -> bool:
    """The marker, tolerant of the same renderings the phrases are.

    Tags are NOT stripped here: the marker is itself an HTML comment, so
    `<[^>]*>` reduces it to the empty string, and an empty needle matches every
    body - including an empty one. That blocked every legitimate PR.
    """
    return bool(MARKER_RE.search(_fold(body, tags=None)))


def labels() -> list[str]:
    raw = os.environ.get("WITNESS_GATE_LABELS_JSON") or "[]"
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return []                        # unreadable labels means no exemption
    return [str(n) for n in parsed] if isinstance(parsed, list) else []


def decide(body: str, label_names: list[str]) -> tuple[int, str]:
    if EXEMPT_LABEL in label_names:
        return 0, f"EXEMPT: the '{EXEMPT_LABEL}' label is applied to this PR."

    if marker_present(body):
        return 1, (
            f"BLOCKED: this PR still carries {MARKER}.\n"
            "         Witness it in a separate session, then delete that line\n"
            "         from the PR description. The check re-runs on the edit."
        )

    folded = normalise(body)
    for phrase in PHRASES:
        if any(phrase in f for f in folded):
            return 1, (
                f'BLOCKED: this PR says "{phrase}", so it is not certified.\n'
                "         Witness it in a separate session and edit that wording out,\n"
                f"         or apply the '{EXEMPT_LABEL}' label if this PR only\n"
                "         discusses the wording. The label is the only exemption;\n"
                "         writing the token into the body does nothing."
            )

    return 0, "OK: no pending-witness marker and no uncertified declaration."


def main() -> int:
    code, message = decide(sys.stdin.read(), labels())
    print(message)
    return code


if __name__ == "__main__":
    sys.exit(main())
