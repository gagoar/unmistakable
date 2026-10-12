# Upstream

This repository packages the `asd-ste100` skill of
[danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill) as a Claude Code plugin.
Upstream is MIT licensed, © 2026 Dustin Yuchen Teng. The full text is in `LICENSE-UPSTREAM`.

| | |
|---|---|
| Pinned commit | `32511c6992ecb5f1971e46a2943f2e6adceedafe` (upstream skill version 0.4.0) |
| Retrieved | 2026-10-12 |
| Skill version here | 0.5.0 |

## What comes from upstream

- `skills/asd-ste100/SKILL.md`, `references/writing-rules.md`, `examples/*.md`: the skill text.
- `internal/stelint/`: a Go port of `scripts/ste-lint.py`. It began as a copy of `internal/stelint` in
  [gagoar/pr-brief](https://github.com/gagoar/pr-brief). Its `UPSTREAM.md` lists the deviations from the Python
  script. The test inputs and the golden files in `internal/stelint/testdata/` are upstream's own.

## What this repository changes

**The skill text.** Each change fixes a statement that the audit against ASD-STE100 Issue 9 found wrong or stale:

1. The passive voice is for an actor that is unknown (Rule 3.6). Upstream also allowed an "irrelevant" actor.
2. Descriptive text gets one topic per sentence (Rule 4.1). One instruction per sentence is a rule for procedures
   (Rule 5.2), with an exception for actions at the same time.
3. "Multi-word nouns" replaces "noun clusters", the term of Issue 9.
4. ASD's current name is used. The unverified figures for the size of the dictionary are gone.
5. Rule numbers are added, and each extension of the skill (hedges, marketing adjectives, dangling conjunctions)
   is labeled `X-`.
6. Part 1 of `examples/before-after.md` is titled "Rule Illustrations", not "Official STE Examples": the
   examples are not ASD's.
7. `scripts/ste-lint.py` is not shipped. The skill runs `bin/ste-lint`.

**The linter.** `--profile upstream` gives upstream's output, byte for byte. The other profiles
(`agent`, the default, `descriptive`, `procedure`) label each finding with its rule number in a `spec` field and
add checks: paragraph length, contractions, `-ing` forms, multi-word nouns, WARNING and CAUTION blocks,
dropped articles, British spellings, and the 20-word limit of procedures. The word lists are this project's own.

## Not shipped

The ASD-STE100 standard is copyright ASD, and ASD-STE100 is a trademark of ASD. This repository ships no part of
the dictionary: no approved words, no words to avoid, no official examples, and none of the text of the rules.
A rule number names a rule. Check each number against your own copy of the standard.

## Sync

A weekly workflow (`.github/workflows/upstream-watch.yml`) compares upstream `HEAD` with the pinned commit. If
upstream has moved, it opens an issue. A maintainer ports the change by hand, runs `STE_PARITY=1 go test
./internal/stelint -run TestParity` against the new commit, and updates the pinned commit in this file.
