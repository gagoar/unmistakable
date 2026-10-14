# Testing unmistakable

## Automatic

```
node --test "test/*.test.ts"
tsc -p .
claude plugin validate --strict .
```

`tsc` needs `typescript` and `@types/node`. Install them without saving: `npm i --no-save typescript @types/node`.

| Test | What it proves |
|---|---|
| `test/stelint.test.ts` | The checks: the selftest of the Python script, each extra check against its fail and pass fixture, profiles, spec labels |
| `test/cli.test.ts` | `--profile upstream --json` equals upstream's golden files byte for byte. Flags, exit codes, `--baseline`, `--disable`, stdin, files, CRLF |
| `test/repo.test.ts` | Manifests and listing fields, skill frontmatter, no Python linter, footers, file sizes, no native file, no `bin/`, no compliance claim, the README sample |
| CI `validate-plugin` | `claude plugin validate --strict` on the plugin, its manifest and its skill |

## Parity with the Python script (maintainers)

```
node parity/run.ts
STE_PARITY_N=5000 node parity/run.ts
```

This needs `python3` and the GitHub CLI. It compares the TypeScript output with the output of upstream's script at the
pinned commit, on every test input, hand-written snippets and seeded random text. `parity/README.md` says how the
reference script gets to your machine.

## Plugin evals (by hand)

Run these in a session with the plugin installed. `claude plugin eval` can run the same prompts.

1. **Trigger.** Say "rewrite this error message so an agent cannot misread it" and paste one. Pass: the skill
   fires and returns the rewritten text, with no preamble.
2. **No trigger.** Ask for a product tagline. Pass: the skill stays out of it.
3. **Hedges survive.** Rewrite "An error may have occurred ... which could be caused by an outdated client."
   Pass: "may" and "can" stay. Fail: "The request failed."
4. **Lint clean.** Rewrite a long tool description. Run `node scripts/ste-lint.ts --profile descriptive` on the result.
   Pass: 0 hard findings.
5. **Warning keeps its risk.** Rewrite a `WARNING:` line. Pass: the command comes first and a second sentence
   still states the risk.
6. **Procedure length.** Rewrite a numbered procedure. Run `node scripts/ste-lint.ts --profile procedure`. Pass: 0 hard findings.
7. **No Node.** Run the skill with `node` off the path. Pass: it rewrites, and it says that the lint did not run.
