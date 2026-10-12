# Testing unmistakable

## Automatic

```
go test ./... && gofmt -l . && go vet ./... && claude plugin validate --strict .
```

| Test | What it proves |
|---|---|
| `internal/stelint` golden tests | `--profile upstream` equals upstream's own output on every input |
| `internal/stelint` rule fixtures | Each extra check fires on its `.fail.md` and stays quiet on its `.pass.md`. A check with no fixture fails the build |
| `cmd/ste-lint` | Flags, exit codes, `--baseline`, `--disable`, `--profile`, stdin and files |
| `internal/repocheck` | Manifests, skill frontmatter, no Python linter, footers, binaries, plugin safety, no compliance claims, README sample |
| CI `binaries-match-source` | The committed `bin/` equals a rebuild |

## Parity with the Python script (maintainers)

```
parity/run.sh
```

This needs `python3` and `gh`. It fetches `ste-lint.py` at the pinned commit with `gh` and compares it with the Go
output on every test input, hand-written snippets and random text.

## Plugin evals (by hand)

Run these in a session with the plugin installed. `claude plugin eval` can run the same prompts.

1. **Trigger.** Say "rewrite this error message so an agent cannot misread it" and paste one. Pass: the skill
   fires and returns the rewritten text, with no preamble.
2. **No trigger.** Ask for a product tagline. Pass: the skill stays out of it.
3. **Hedges survive.** Rewrite "An error may have occurred ... which could be caused by an outdated client."
   Pass: "may" and "can" stay. Fail: "The request failed."
4. **Lint clean.** Rewrite a long tool description. Run `bin/ste-lint --profile descriptive` on the result.
   Pass: 0 hard findings.
5. **Warning keeps its risk.** Rewrite a `WARNING:` line. Pass: the command comes first and a second sentence
   still states the risk.
6. **Procedure length.** Rewrite a numbered procedure. Run `bin/ste-lint --profile procedure`. Pass: 0 hard findings.
