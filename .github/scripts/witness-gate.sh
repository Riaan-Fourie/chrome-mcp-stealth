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
# ---------------------------------------------------------------------------
# Two failures this script has already had. Both were fail-OPEN, and both were
# invisible from the outside - the check simply went green.
#
# 1. SIGPIPE (the reason nothing here is a pipeline used as a condition).
#    `printf '%s' "$BODY" | grep -qiF '...'` looks obviously correct. Under
#    `set -o pipefail` it is not: `grep -q` exits the instant it matches and
#    closes the pipe, `printf` is killed by SIGPIPE, and pipefail reports the
#    pipeline as 141. The `if` then takes the false branch and the marker is
#    never recorded. It needs a body big enough that printf has not finished
#    writing - about 64KB, comfortably inside GitHub's 65,536-character limit -
#    and it is worst when the marker sits at the TOP of the body, which is
#    exactly where anyone would put it. So: matching is done in pure bash, and
#    the one place a pipeline is still used (normalisation) is a command
#    substitution, which reads its input to completion.
#
# 2. Exempting on body text. The first cut read the exemption out of the body,
#    and the first PR to run the gate exempted itself by merely DOCUMENTING the
#    token while explaining how the gate worked. Blocking on prose fails closed
#    and is safe; exempting on prose fails open. The exemption is a label, which
#    cannot be triggered by writing about it.
# ---------------------------------------------------------------------------
set -euo pipefail

BODY="$(cat)"

# The exemption: a deliberate, attributed, revocable act, never body text.
# Matched with its JSON quotes so "witness-gate-exempt-draft" cannot satisfy a
# gate meant for "witness-gate-exempt". Pure bash - no pipeline, no SIGPIPE.
if [[ "${WITNESS_GATE_LABELS_JSON:-[]}" == *'"witness-gate-exempt"'* ]]; then
  echo "EXEMPT: the 'witness-gate-exempt' label is applied to this PR."
  exit 0
fi

# Normalise before matching, so the declaration cannot hide behind formatting:
#   - markdown emphasis removed, so "**not** yet witnessed" still reads as prose
#   - every run of whitespace becomes one space, so a hard-wrapped body where
#     "not yet\nwitnessed" straddles a line break is still one phrase
#   - lowercased, so case is irrelevant
# A command substitution, not a pipeline condition: it reads to completion.
norm="$(printf '%s' "$BODY" | tr -d '*_`~' | tr '\r\n\t' '   ' | tr -s ' ' | tr '[:upper:]' '[:lower:]')"

# Every way a human or an agent actually writes "this is not certified yet".
# The gate missed its own author's wording once: PR #6 said "Maker-side only -
# so it is not certified" and sailed through, because only one exact phrase was
# recognised. Breadth here costs a false block, which is the safe direction.
PHRASES=(
  "not yet witnessed"
  "not witnessed yet"
  "not been witnessed"
  "not witnessed"
  "unwitnessed"
  "not yet certified"
  "not certified"
  "not been certified"
  "uncertified"
  "do not merge"
  "<!-- witness: pending -->"
)

hit=""
for p in "${PHRASES[@]}"; do
  if [[ "$norm" == *"$p"* ]]; then
    hit="$p"
    break
  fi
done

if [ -n "$hit" ]; then
  echo "BLOCKED: this PR says \"${hit}\", so it is not certified and must not merge."
  echo "         Witness it in a separate session, edit that wording out of the body,"
  echo "         or apply the 'witness-gate-exempt' label if this PR only discusses it."
  exit 1
fi

echo "OK: the PR body makes no uncertified declaration."
exit 0
