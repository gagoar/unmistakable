import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cli, ROOT } from "./helpers.ts";

process.chdir(ROOT);

const MIN_GOLDEN_FILES = 4;
const WORDS_OVER_PROCEDURE_LIMIT = 22;
const EXIT_USAGE = 2;
const EXIT = { ok: 0, findings: 1, usage: EXIT_USAGE } as const;
// Newlines at the end of a text. Replaced with nothing: "a\n\n" → "a"; "a" is unchanged.
// https://regex101.com/?flavor=javascript&regex=%5Cn%2B%24&flags=m&testString=a%0A%0A%0Aa
const TRAILING_NEWLINES = /\n+$/;

// The .json extension at the end of a file name. Replaced with nothing: "a.md.json" → "a.md"; "a.json.md" is unchanged.
// https://regex101.com/?flavor=javascript&regex=%5C.json%24&flags=m&testString=a.md.json%0Aa.json.md
const JSON_EXTENSION = /\.json$/;

// --json must equal upstream's own output, byte for byte, for every test input. Upstream labels each
// violation with the path it was given, so the run uses the same relative path.
test("--profile upstream --json equals the upstream golden files", () => {
  const goldens = readdirSync("testdata/golden").filter((name) => name.endsWith(".json"));
  assert.ok(goldens.length >= MIN_GOLDEN_FILES);
  goldens.forEach((golden) => {
    const input = `testdata/${golden.replace(JSON_EXTENSION, "")}`;
    const want = readFileSync(`testdata/golden/${golden}`, "utf8").replace(TRAILING_NEWLINES, "");
    assert.equal(cli(["--profile", "upstream", "--json", input]).out, want, input);
  });
});

// Each row: the text, the arguments, the exit code, and a piece of the report.
const REPORTS: readonly (readonly [text: string, args: readonly string[], code: number, piece: string])[] = [
  ["Close the valve.\n", [], EXIT.ok, "0 violations"],
  ["Close the valve; open the door.\n", [], EXIT.findings, "semicolon"],
  ["Close the valve; open the door.\n", ["--baseline", "1"], EXIT.ok, "1 hard, baseline 1"],
  ["Close the valve; open the door.\n", ["--disable", "semicolon"], EXIT.ok, "0 violations"],
  ["The request may have failed.\n", [], EXIT.ok, "0 violations"],
];

test("exit codes and the report", () => {
  REPORTS.forEach(([text, args, code, piece]) => {
    const result = cli(args, text);
    assert.equal(result.code, code, `${JSON.stringify(text)} ${args.join(" ")}`);
    assert.ok(result.out.includes(piece), result.out);
  });
});

test("the default profile is agent, and it labels each rule with its spec", () => {
  const text = "The task isn't done; the colour is grey.\n";
  const result = cli([], text);
  assert.equal(result.code, EXIT.findings);
  assert.ok(result.out.includes("contraction (STE-4.2)") && result.out.includes("semicolon (STE-8.1)"), result.out);
  const upstream = cli(["--profile", "upstream"], text);
  assert.ok(!upstream.out.includes("contraction") && !upstream.out.includes("(STE-"), upstream.out);
  assert.ok(cli(["--json"], text).out.includes('"spec": "STE-4.2"'));
  assert.ok(cli(["--profile", "procedure"], `${"word ".repeat(WORDS_OVER_PROCEDURE_LIMIT)}.\n`).out.includes("procedure-length"));
});

test("files are merged and named", () => {
  const dir = mkdtempSync(join(tmpdir(), "ste-"));
  const [a, b] = [join(dir, "a.md"), join(dir, "b.md")] as const;
  writeFileSync(a, "Close the valve; open the door.\n");
  writeFileSync(b, "Open the door; close the valve.\n");
  const result = cli([a, b]);
  assert.equal(result.code, EXIT.findings);
  assert.ok(result.out.includes(`${a}:1:`) && result.out.includes(`${b}:1:`) && result.out.includes("2 violations (2 hard"), result.out);
});

test("a CRLF file gives the same findings as an LF file", () => {
  const lf = cli(["--json"], "Close; open.\nA; b.\n").out;
  assert.equal(cli(["--json"], "Close; open.\r\nA; b.\r\n").out, lf);
});

const BAD_ARGUMENTS: readonly (readonly string[])[] = [["--nope"], ["--baseline"], ["--baseline", "x"], ["--baseline", "-1"], ["--disable"], ["--profile"], ["--profile", "nope"], ["/no/such/file.md"]];

test("usage errors exit 2 with a message", () => {
  BAD_ARGUMENTS.forEach((args) => {
    const result = cli(args);
    assert.equal(result.code, EXIT.usage, args.join(" "));
    assert.ok(result.err, args.join(" "));
  });
  const version = cli(["version"]);
  assert.equal(version.code, EXIT.ok);
  // The version that the script prints is the version of the plugin, so a release cannot change one and not the other.
  const manifest: { readonly version: string } = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
  assert.equal(version.out, manifest.version);
});

// The entry point must not depend on how the path to it is spelled. On macOS /tmp is a symlink, and a plugin cache can sit under
// one: an entry guard that compared the real path with argv made the script print nothing there.
test("the entry point runs through a symlinked path", () => {
  const link = join(mkdtempSync(join(tmpdir(), "ste-link-")), "scripts");
  symlinkSync(join(ROOT, "scripts"), link);
  const result = spawnSync("node", [join(link, "ste-lint.ts")], { input: "Close; open.\n", encoding: "utf8" });
  assert.equal(result.status, EXIT.findings, result.stderr);
  assert.ok(result.stdout.includes("semicolon"), `stdout: ${result.stdout} stderr: ${result.stderr}`);
});
