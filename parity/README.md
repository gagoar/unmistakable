# Parity check against upstream

`scripts/` ports `scripts/ste-lint.py` from github.com/danyuchn/asd-ste100-skill. This optional check proves that
`--profile upstream` gives the same output as the Python script, byte for byte. It is for maintainers: the normal
tests need no Python.

```
node parity/run.ts
STE_PARITY_N=5000 STE_PARITY_SEED=7 node parity/run.ts
```

It compares, byte for byte:

- every `testdata/*.md` and `*.txt` file,
- one run with `--baseline` and `--disable`,
- a list of hand-written Unicode and Markdown snippets, fed on stdin,
- a seeded random corpus (300 inputs by default).

By default it fetches `scripts/ste-lint.py` at the pinned commit in `UPSTREAM.md` with `gh api`. It needs read access to
a public repository only.

| Variable | Meaning |
|---|---|
| `STE_PARITY_N` | The number of random inputs. |
| `STE_PARITY_SEED` | The seed of the random corpus. A failing input is replayed with the same seed. |
| `STE_UPSTREAM_SCRIPT=/path/ste-lint.py` | Use a local copy instead of `gh`. |
