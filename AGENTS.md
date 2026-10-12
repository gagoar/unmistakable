# AGENTS.md

unmistakable is a Go CLI (standard library only) shipped with a Claude Code plugin. The plugin packages the
`asd-ste100` skill and the `ste-lint` linter.

Rules an agent cannot infer from the code:

- After any change to Go code, run `./build.sh` and commit `bin/`. CI rebuilds every binary and fails if one
  differs. Never edit `bin/` by hand.
- Add no third-party Go modules. A test fails if `go.mod` has a `require`.
- Go is pinned in `.go-version`. Builds use `-buildvcs=false`, so the same source gives the same bytes.
- `--profile upstream` must equal upstream's `ste-lint.py --json` byte for byte. The golden files in
  `internal/stelint/testdata/golden/` are upstream's own output. Never regenerate them with the Go code.
- Every check outside upstream has `testdata/rules/<id>.pass.md` and `<id>.fail.md`. A test fails if one is missing.
- A rule number (`STE-6.6`) names a rule of ASD-STE100 Issue 9. Never copy the dictionary, the words to avoid,
  an official example or the text of a rule into this repository. ASD owns the copyright. Never write that a text
  or this tool is "STE-compliant", certified or endorsed. A test checks the README, the docs and the manifests.
- The footer of every page in `docs/` shows the version in `.claude-plugin/plugin.json`. A test checks it.
- The sample output in `README.md` is the real output of `bin/ste-lint`. A test checks it. After a change to a
  check, copy the new output in.
- After a change to `docs/assets/*.html`, run `./build.sh assets`.
- Keep the skill's name `asd-ste100`. pr-brief calls the skill by that name.
- Upstream changes go in by hand. Update the pinned commit in `UPSTREAM.md` and run the parity check.
- Check: `go test ./... && gofmt -l . && go vet ./... && claude plugin validate --strict .`
