<p align="center"><img src="docs/assets/icon.png" width="120" alt="unmistakable"></p>

# unmistakable

**Rewrite English so an AI agent cannot misread it.** A Claude Code plugin with a skill that rewrites text, and a linter that checks the result. It follows the [ASD-STE100](https://www.asd-ste100.org/) rules for Simplified Technical English.

Use it for text that a model, a pipeline or a non-native reader must parse with nobody there to ask what you meant: tool descriptions, error messages, system prompts, inter-agent instructions, status reports and PR descriptions.

| Before | After |
|---|---|
| This tool will attempt to synchronize state across the various backends that have been configured, and if a conflict is detected it may resolve it automatically depending on the strategy that has been set, or otherwise it will surface the conflict for manual review. | The tool tries to synchronize state across the configured backends. If it finds a conflict, it reads the configured strategy. If the strategy allows automatic resolution, the tool may resolve the conflict without a user. If the tool does not resolve the conflict, it reports the conflict for manual review. |
| An error may have occurred while processing your request due to a possible mismatch in the expected data format, which could be caused by an outdated client version. | Your request may have failed. The cause may be a data format that does not match what the server expects. An outdated client can cause this mismatch. Check your client version. |

The rewrite keeps every hedge. "May have failed" stays "may have failed": confidence is content, and a rewrite that sounds surer than the author is wrong.

## Install

```
/plugin marketplace add gagoar/gago-plugins
/plugin install unmistakable@gago-plugins
```

Or add this repository on its own: `/plugin marketplace add gagoar/unmistakable`.

Then ask in plain words: "rewrite this tool description so an agent cannot misread it", "disambiguate this error message", or "apply Simplified Technical English to this README". The skill is `asd-ste100`, so you can also call `/unmistakable:asd-ste100`.

## The linter

`scripts/ste-lint.ts` is TypeScript that Node runs as it is: Node 22.18 or later, no build step, no binary, nothing to install. The skill runs it on its own output, and you can run it on any file.

```
$ echo "We spin up the box; it isn't running." | node scripts/ste-lint.ts
<stdin>:1:4 phrasal-verb (STE-9.3): Soft phrasal verb. Use the single plain verb (start, contact, read, begin). [spin up]
<stdin>:1:19 semicolon (STE-8.1): STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]
<stdin>:1:24 contraction (STE-4.2): Contraction. Write the full words (do not, it is, cannot). [isn't]

3 violations (3 hard, baseline 0), 8 words, 37.5 per 100 words
Hedges/modality (may, might, could) are never flagged: confidence is content.
```

Exit 1 when the hard findings exceed `--baseline N` (default 0). `--json` prints the report as JSON. `--disable a,b` silences rules.

| Profile | What it checks |
|---|---|
| `agent` (default) | Every check, for text that an agent reads |
| `descriptive` | The checks that follow a numbered STE rule, 25 words per sentence |
| `procedure` | `descriptive`, with 20 words per sentence |
| `upstream` | Exactly the checks of the original `ste-lint.py`, byte for byte |

The checks: semicolons, phrasal verbs, nominalizations, passive voice, compound tenses, one term per action, sentence length, paragraph length, contractions, `-ing` forms, multi-word nouns, WARNING and CAUTION blocks, dropped articles, British spellings, marketing adjectives and dangling conjunctions in lists. Each finding carries the rule number it follows (`STE-6.6`). A check that is not an STE rule has the prefix `X-`. The linter never flags hedges or modality.

The linter has no part-of-speech tagger. It finds structure, not meaning. It does not prove that a rewrite kept the meaning: that is the job of the skill, and of you.

## What is in the repository

| | |
|---|---|
| `skills/asd-ste100/` | The skill: when to use it, the rewrite rules, the output format, worked examples |
| `scripts/` | The linter, in TypeScript with no dependency. About 60 KB in all, and no file over 25 KB |
| `test/`, `testdata/`, `parity/` | The tests, upstream's own golden files, and the check against the Python script |
| `UPSTREAM.md` | Where the skill comes from, and every change made to it |

## Credit

The skill and the first linter are by Dustin Yuchen Teng: [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill), MIT. This plugin packages them, fixes the statements that the audit against Issue 9 found wrong, ports the linter to TypeScript, and adds profiles and checks. `UPSTREAM.md` lists every change.

## Not endorsed by ASD

ASD-STE100 is a copyright and a trademark of ASD, Brussels. This project is not made, checked or endorsed by ASD, and it does not claim that a text complies with the standard. It ships no part of the ASD-STE100 dictionary and none of the text of the rules. A rule number only names a rule. Get the standard, free, from [asd-ste100.org](https://www.asd-ste100.org/).

## Privacy

unmistakable collects nothing. The skill runs in your session and the linter runs on your machine. Neither makes a network call, and neither stores or sends your text. The plugin has no hook, no server and no telemetry.

## Terms

MIT license: use it, change it and share it, with the notice. It comes as it is, with no warranty. Rewrites are suggestions: read each one before you ship it, because the linter checks structure and cannot prove that a rewrite kept the meaning.

## License

MIT. The upstream notice is in `LICENSE-UPSTREAM`.
