#!/usr/bin/env bash
# Witness gate (Jarvis #510): decide whether a PR body declares itself uncertified.
#
# Reads the PR body on stdin. Exits 0 to allow the merge, 1 to block it, and
# explains itself on stdout either way.
#
# The decision lives here rather than inline in the workflow so it can be run
# against a real PR body without pushing a commit - a gate nobody can test is a
# gate nobody trusts.
set -euo pipefail

BODY="$(cat)"

# Deliberate, recorded opt-out. A PR about the witness machinery itself has to be
# able to quote the marker without blocking on it. Explicit act, visible in the
# body and in review - not a default, and not inferred.
if printf '%s' "$BODY" | grep -qiF '<!-- witness-gate: exempt -->'; then
  echo "EXEMPT: witness-gate exemption declared in the PR body."
  exit 0
fi

# Matched as plain text anywhere in the body, including inside fenced code blocks
# and quoted replies. A quoted "not yet witnessed" is not a licence to merge; the
# author can edit the quote or declare the exemption above.
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
