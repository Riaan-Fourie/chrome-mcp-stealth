#!/usr/bin/env python3
"""Fixtures for the witness gate. Run: python3 .github/scripts/test_witness_gate.py

Every case here is a defect this gate actually had, or a body it actually
blocked when it should not have. They are committed so a regression is caught
rather than rediscovered by the next witness.
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from witness_gate import MARKER, decide  # noqa: E402

BLOCK, ALLOW = 1, 0
cases: list[tuple[str, str, list[str], int]] = []


def case(name, body, labels, expect):
    cases.append((name, body, labels, expect))


# --- the marker, which is what the PR template ships -------------------------
case("marker alone", MARKER, [], BLOCK)
case("marker in a filled-in template", f"## What\nFixes a thing.\n\n{MARKER}\n", [], BLOCK)
case("marker removed after witnessing", "## What\nFixes a thing.\n", [], ALLOW)

# --- the SIGPIPE band: intermittent from ~61.5KB, deterministic at 65,597 ----
# Marker first, filler after, which is where the old shell version failed open.
for size in (1_000, 61_500, 65_000, 65_597, 70_000, 120_000):
    case(f"marker at top, {size}B body", MARKER + "\n" + ("x" * size), [], BLOCK)
    case(f"marker at end, {size}B body", ("x" * size) + "\n" + MARKER, [], BLOCK)
case("large clean body", "All witnessed and certified.\n" + ("x" * 70_000), [], ALLOW)

# --- renderings that GitHub displays as a literal "Not yet witnessed" --------
case("non-breaking space", "Not yet witnessed", [], BLOCK)
case("soft hyphen", "Not yet wit­nessed", [], BLOCK)
case("zero-width space", "Not yet wit​nessed", [], BLOCK)
case("zero-width joiner", "Not‍ yet witnessed", [], BLOCK)
case("html entity", "Not&nbsp;yet witnessed", [], BLOCK)
case("span mid-phrase", "Not yet <span>wit</span>nessed", [], BLOCK)
case("marker with zero-width inside", "<!-- witness:​ pending -->", [], BLOCK)
case("hard-wrapped phrase", "This is not yet\nwitnessed.", [], BLOCK)
case("bold emphasis inside phrase", "This is **not** yet witnessed.", [], BLOCK)
case("uppercase", "NOT YET WITNESSED", [], BLOCK)

# --- legitimate bodies the widened phrase list used to block wrongly ---------
case("PR adding witness evidence",
     "Adds the witness doc. The fail-open was not witnessed after the fix.", [], ALLOW)
case("TLS PR", "Rejects an uncertified CA in the handshake path.", [], ALLOW)
case("CONTRIBUTING update",
     "Documents that contributors do not merge their own PRs.", [], ALLOW)
case("release note", "Do not merge this branch into release/1.x by hand.", [], ALLOW)
case("changelog", "Marks the old endpoint as uncertified for production use.", [], ALLOW)
case("test description", "Adds a test for the not-witnessed code path.", [], ALLOW)
case("issue quote", "Closes #123, which said the output was not certified.", [], ALLOW)
case("plain feature", "Adds retry with backoff. Two tests.", [], ALLOW)

# --- the backstop phrases, for PRs opened with `gh pr create --body` ---------
case("not yet witnessed", "Maker-side only, not yet witnessed.", [], BLOCK)
case("not yet certified", "This is not yet certified.", [], BLOCK)
case("awaiting witness", "Awaiting witness before merge.", [], BLOCK)
case("witness pending", "Witness pending, please hold.", [], BLOCK)

# --- the exemption is a label, never body text ------------------------------
case("exempt label", MARKER, ["witness-gate-exempt"], ALLOW)
case("exempt label among others", MARKER, ["bug", "witness-gate-exempt"], ALLOW)
case("lookalike label -draft", MARKER, ["witness-gate-exempt-draft"], BLOCK)
case("lookalike label pre-", MARKER, ["pre-witness-gate-exempt"], BLOCK)
case("unrelated label", MARKER, ["bug"], BLOCK)
case("body documents the exempt token",
     f"Apply the `witness-gate-exempt` label. {MARKER}", [], BLOCK)
case("body documents it, no marker",
     "Apply the `witness-gate-exempt` label to opt out.", [], ALLOW)

# --- mangled markers: invisible when rendered, so both author and a strict
# --- matcher see nothing. All of these must still block.
case("marker, no inner spaces", "<!--witness: pending-->", [], BLOCK)
case("marker, no space after colon", "<!-- witness:pending -->", [], BLOCK)
case("marker, space before colon", "<!-- witness : pending -->", [], BLOCK)
case("marker, trailing full stop", "<!-- witness: pending. -->", [], BLOCK)
case("marker, html5 --!> close", "<!-- witness: pending --!>", [], BLOCK)
case("marker, left-to-right mark inside", "<!-- witness:‎ pending -->", [], BLOCK)
case("marker, uppercase", "<!-- WITNESS: PENDING -->", [], BLOCK)
case("marker, newline inside", "<!-- witness:\npending -->", [], BLOCK)
case("not the marker", "<!-- witness: done -->", [], ALLOW)
case("comment mentioning witness", "<!-- ask the witness about this -->", [], ALLOW)

# --- accepted residual -------------------------------------------------------
# A PR that quotes the gate's own failure line is blocked, because that line
# necessarily contains the phrase. This is recorded rather than papered over
# with a weaker stand-in: the remedy is the exemption label, which is exactly
# what a PR about this machinery should carry.
case("PR quoting the gate's failure line",
     'The gate prints: BLOCKED: this PR says "not yet witnessed".', [], BLOCK)
case("same, with the exemption label",
     'The gate prints: BLOCKED: this PR says "not yet witnessed".',
     ["witness-gate-exempt"], ALLOW)

# --- degenerate --------------------------------------------------------------
case("empty body", "", [], ALLOW)
case("whitespace only", "   \n\t  ", [], ALLOW)


def boundary_cases() -> list[str]:
    """Exercise the real stdin and env boundaries, not just decide().

    Mutation testing found these were the only two surviving mutants: the suite
    never called labels() or main(), so the env and stdin edges had no coverage
    at all. That is precisely where the original SIGPIPE defect lived.
    """
    import subprocess

    script = __file__.rsplit("/", 1)[0] + "/witness_gate.py"
    checks = [
        ("stdin marker blocks", MARKER, "[]", 1),
        ("stdin clean allows", "All witnessed.", "[]", 0),
        ("stdin large body blocks", MARKER + "\n" + "x" * 70_000, "[]", 1),
        ("label exempts", MARKER, '["witness-gate-exempt"]', 0),
        ("malformed label json does not exempt", MARKER, "{not json", 1),
        ("empty label env does not exempt", MARKER, "", 1),
        ("null label json does not exempt", MARKER, "null", 1),
    ]
    failures = []
    for name, body, labels_json, expect in checks:
        proc = subprocess.run(
            [sys.executable, script],
            input=body,
            capture_output=True,
            text=True,
            timeout=60,
            env={**__import__("os").environ, "WITNESS_GATE_LABELS_JSON": labels_json},
        )
        if proc.returncode != expect:
            failures.append(
                f"  boundary/{name}: expected exit {expect}, got {proc.returncode}"
            )
    return failures


def main() -> int:
    failures = []
    for name, body, labels, expect in cases:
        got, message = decide(body, labels)
        if got != expect:
            failures.append(
                f"  {name}: expected {'BLOCK' if expect else 'ALLOW'}, "
                f"got {'BLOCK' if got else 'ALLOW'} - {message.splitlines()[0]}"
            )
    passed = len(cases) - len(failures)
    boundary = boundary_cases()
    failures += boundary
    print(
        f"witness gate: {passed}/{len(cases)} fixtures and "
        f"{7 - len(boundary)}/7 boundary checks passed"
    )
    for line in failures:
        print(line)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
