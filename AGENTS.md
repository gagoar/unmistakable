# AGENTS.md

unmistakable is a Claude Code plugin. It packages the `asd-ste100` skill and the `ste-lint` linter. The linter is
TypeScript with no dependency. Node runs it as it is (22.18 or later): there is no build step and there is no binary.

Rules an agent cannot infer from the code:

- Write TypeScript with the `typescript-patterns-enforcer` skill, and run its hook on every file you touch:
  `echo '{"tool_input":{"file_path":"<file>"}}' | node <enforcer>/engine/dist/check.js`. No `any`, no `switch`, no
  raw loop, no magic number, no nested ternary. Every regex has a comment with an example, and a row in `REGEXES.md` with its tester link. Put no tester link in a code file: the directory scan holds the plugin for review when a code file has a remote URL. A test checks both. The `require-regex-example` hook asks for a link in the comment: ignore that one finding.
- Node must run the files as they are, so use only syntax that Node can strip: no `enum`, no `namespace`, no
  parameter properties. Import with the `.ts` extension, and use `import type` for types.
- Ship no binary and no bundle. A native file, or a file over 1 MiB, holds the plugin for review in the directory scan.
  A script or a document over 256 KiB is not read in full. A test checks both, and it checks that no top-level `bin/`
  exists (it stops the install on Cowork and claude.ai).
- Add no dependency. `package.json` has none. CI installs `typescript` and `@types/node` for `tsc` only, and does not save them.
- `--profile upstream` must equal upstream's `ste-lint.py --json` byte for byte. The golden files in
  `testdata/golden/` are upstream's own output. Never regenerate them with this code.
- Every check outside upstream has `testdata/rules/<id>.pass.md` and `<id>.fail.md`. A test fails if one is missing.
- A rule number (`STE-6.6`) names a rule of ASD-STE100 Issue 9. Never copy the dictionary, the words to avoid,
  an official example or the text of a rule into this repository. ASD owns the copyright. Never write that a text
  or this tool is "STE-compliant", certified or endorsed. A test checks the README, the docs and the manifests.
- The footer of every page in `docs/` shows the version in `.claude-plugin/plugin.json`. A test checks it.
- The sample output in `README.md` is the real output of `scripts/ste-lint.ts`. A test checks it. After a change to a
  check, copy the new output in.
- After a change to `docs/assets/*.html`, run `scripts/render-assets.sh` and commit the images.
- Keep the skill's name `asd-ste100`. pr-brief calls the skill by that name.
- Upstream changes go in by hand. Update the pinned commit in `UPSTREAM.md` and run `node parity/run.ts`.
- Check: `node --test "test/*.test.ts"`, then `tsc -p .`, then `claude plugin validate --strict .`
