#!/usr/bin/env bash
# Witness gate (Jarvis #510): decide whether a PR declares itself uncertified.
#
#   stdin                       the PR body
#   WITNESS_GATE_LABELS_JSON    the PR's label names, as a JSON array
#
# Exits 0 to allow the merge, 1 to block it, and explains itself on stdout.
#
# The decision lives here rather than inline in the workflow so it can be run
# against a real PR body without pushing a commit - a gate nobody can test is a
# gate nobody trusts.
#
# Why the exemption is a LABEL and not body text:
#
#   The first cut read the exemption out of the body as plain text. The very
#   first PR to use the gate then exempted itself simply by DOCUMENTING the
#   token in backticks while explaining how the gate worked. Blocking on prose
#   fails closed and is safe; exempting on prose fails OPEN, and any PR that so
#   much as mentions the token would sail through. A label cannot be triggered
#   by writing about it - it takes a deliberate, attributed, revocable act.
set -euo pipefail

BODY="$(cat)"

# The name is matched with its JSON quotes, so a label merely starting or ending
# with the token ("witness-gate-exempt-draft") cannot satisfy it.
if printf '%s' "${WITNESS_GATE_LABELS_JSON:-[]}" | grep -qF '"witness-gate-exempt"'; then
  echo "EXEMPT: the 'witness-gate-exempt' label is applied to this PR."
  exit 0
fi

# Matched as plain text anywhere in the body, including inside fenced code blocks
# and quoted replies. A quoted "not yet witnessed" is not a licence to merge; the
# author edits the quote, or applies the exemption label.
hit=""
if printf '%s' "$BODY" | grep -qiF 'not yet witnessed'; then
  hit='the phrase "not yet witnessed"'
elif printf '%s' "$BODY" | grep -qiF '<!-- witness: pending -->'; then
  hit='the marker <!-- witness: pending -->'
fi

if [ -n "$hit" ]; then
  echo "BLOCKED: this PR body still contains ${hit}, so it is not certified and must not merge."
  exit 1
fi

echo "OK: no uncertified marker in the PR body."
exit 0
