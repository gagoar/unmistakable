#!/usr/bin/env node
// Compares this port with the original ste-lint.py, byte for byte, under --profile upstream.
// For maintainers. It needs python3 and gh (or STE_UPSTREAM_SCRIPT, a path to the script).
//
//   node parity/run.ts                  300 random inputs
//   STE_PARITY_N=5000 node parity/run.ts
//
// It checks every file in testdata, a run with --baseline and --disable, a list of hand-written snippets, and a
// seeded random corpus built from tricky tokens. The script is fetched at the commit pinned in UPSTREAM.md.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/cli.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const MAX_FAILURES = 5;
const DEFAULT_COUNT = 300;
const DEFAULT_SEED = 100;
const MIN_TOKENS = 3;
const TOKEN_SPREAD = 40;
const SPACE_ODDS = 5;
const TWO_TO_32 = 4_294_967_296;
const INPUT_PREVIEW = 200;
const OUTPUT_PREVIEW = 300;
// The constants of mulberry32.
const INCREMENT = 0x6d2b79f5;
const SHIFT_A = 15;
const SHIFT_B = 7;
const OR_B = 61;
const SHIFT_C = 14;

// A 40-character commit hash, as a hex string.
// Matches "32511c6992ecb5f1971e46a2943f2e6adceedafe"; rejects "32511c6".
// https://regex101.com/?flavor=javascript&regex=%5B0-9a-f%5D%7B40%7D&flags=gm&testString=32511c6992ecb5f1971e46a2943f2e6adceedafe%0A32511c6
const COMMIT = /[0-9a-f]{40}/;
// White space anywhere, which base64 text from the GitHub API may hold. Replaced with nothing: "YQ==\n" → "YQ==".
// https://regex101.com/?flavor=javascript&regex=%5Cs&flags=g&testString=YQ%3D%3D%0A%0AYQ%3D%3D
const ANY_SPACE = /\s/g;
// The newline that Python's print adds at the end of its output. Replaced with nothing: "{}\n" → "{}"; "{}" is unchanged.
// https://regex101.com/?flavor=javascript&regex=%5Cn%24&flags=gm&testString=%7B%7D%0A%0A%7B%7D
const FINAL_NEWLINE = /\n$/;

function upstreamScript(): string {
  const fromEnv = process.env["STE_UPSTREAM_SCRIPT"];
  if (fromEnv) return fromEnv;
  const sha = COMMIT.exec(readFileSync("UPSTREAM.md", "utf8"))?.[0];
  if (!sha) throw new Error("no pinned commit in UPSTREAM.md");
  const fetched = spawnSync("gh", ["api", `repos/danyuchn/asd-ste100-skill/contents/scripts/ste-lint.py?ref=${sha}`, "--jq", ".content"], { encoding: "utf8" });
  if (fetched.status !== EXIT_OK) throw new Error(`gh api failed: ${fetched.stderr}`);
  const path = join(mkdtempSync(join(tmpdir(), "ste-parity-")), "ste-lint.py");
  writeFileSync(path, Buffer.from(fetched.stdout.replace(ANY_SPACE, ""), "base64"));
  return path;
}

const script = upstreamScript();

function python(stdin: string, args: readonly string[]): string {
  const result = spawnSync("python3", ["-I", script, "--json", ...args], { input: stdin, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  if (result.status !== EXIT_OK && result.status !== EXIT_FINDINGS) throw new Error(`upstream exit ${result.status}: ${result.stderr}`);
  return result.stdout.replace(FINAL_NEWLINE, "");
}

function port(stdin: string, args: readonly string[]): string {
  const lines: string[] = [];
  run(["--profile", "upstream", "--json", ...args], { stdin: () => stdin, out: (text) => lines.push(text), err: (text) => lines.push(text) });
  return lines.join("\n");
}

let checks = 0;
let failures = 0;

function compare(label: string, stdin: string, args: readonly string[] = []): void {
  checks += 1;
  const got = port(stdin, args);
  const want = python(stdin, args);
  if (got === want) return;
  failures += 1;
  console.error(`MISMATCH ${label}\n  input: ${JSON.stringify(stdin).slice(0, INPUT_PREVIEW)}\n  got:  ${got.slice(0, OUTPUT_PREVIEW)}\n  want: ${want.slice(0, OUTPUT_PREVIEW)}`);
}

readdirSync("testdata")
  .filter((name) => name.endsWith(".md") || name.endsWith(".txt"))
  .forEach((name) => compare(`file ${name}`, "", [`testdata/${name}`]));
compare("options", "", ["--baseline", "5", "--disable", "passive-voice,semicolon", "testdata/parity-extra.md"]);

const SNIPPETS: readonly string[] = [
  "", "a", "a; b", "x is used for parsing and was sent for running.", "It was done by hand. It was sent to running.", "The file is is set to making.",
  "may have run, has been had, have had gone", "He MIGHT NOT have run; she could’nt have.", "Ünïcode wörd was removed. é seamless",
  "éseamless seamlessé _seamless_ seamless_", "Check. verify this. confirm", "blazing fast blazing-fast blazing fast", "spin up spin up",
  "Perform an analysis of x. Perform an éanalysis.", "Ends with and ", "- a and \n- b or　", "word second; line third",
  "a | b\n--- | ---\nc \\| d | e;", "|a|b|\n|---|---|\n|x\\|y|z; q|", "KKeep ſtart the sſtop. İs ıs",
  `Long ${"w ".repeat(TOKEN_SPREAD)}end. Short.`, "Tab\there\ttext;\u0000nul", "﻿BOM; line", "emoji \u{1F600}; \u{1F600} seamless",
  "> - quote and\n> - x or", "- a\n\n  and\n- b and\n  ```\n  x and\n  ```\n", "1) x\n   - y and\n2) z or",
];
SNIPPETS.forEach((text, i) => compare(`snippet ${i}`, text));

const TOKENS: readonly string[] = [
  "is", "are", "was", "were", "been", "being", "has", "have", "had", "may", "might", "could", "not", "n’t", "used", "removed", "run", "set", "gone", "begun",
  "to", "for", "by", "parsing", "running", "and", "or", ";", ".", "!", "?", "|", "`code`", "`", "```", "~~~", "-", "*", "1.", "2)", "perform", "an", "analysis", "carry out",
  "seamless", "robust", "check", "verify", "confirm", "use", "utilize", "spin up", "kick off", "é", "ü", "日本", " ", "　", "\t", "  ", "\n", "\n", "\r\n", "\r", "\v", "\x1c", "\x1f",
  "\u0085", "|---|---|", "---", "a | b", "ſ", "K", "ı", "Straße", "x", "\u{1F600}", " ", " ",
];

// mulberry32: a small seeded generator, so a failing input can be replayed with the same seed.
function seeded(seed: number): () => number {
  const mix = { state: seed >>> 0 };
  return () => {
    mix.state = (mix.state + INCREMENT) >>> 0;
    const a = Math.imul(mix.state ^ (mix.state >>> SHIFT_A), mix.state | 1);
    const b = a ^ (a + Math.imul(a ^ (a >>> SHIFT_B), a | OR_B));
    return ((b ^ (b >>> SHIFT_C)) >>> 0) / TWO_TO_32;
  };
}

const random = seeded(Number(process.env["STE_PARITY_SEED"] ?? DEFAULT_SEED));
const pick = (n: number): number => Math.floor(random() * n);
const randomText = (): string =>
  Array.from({ length: MIN_TOKENS + pick(TOKEN_SPREAD) }, () => `${TOKENS[pick(TOKENS.length)] ?? ""}${pick(SPACE_ODDS) ? " " : ""}`).join("");

const count = Number(process.env["STE_PARITY_N"] ?? DEFAULT_COUNT);
Array.from({ length: count }, (_, n) => n).every((n) => {
  compare(`random ${n}`, randomText());
  return failures < MAX_FAILURES;
});

console.log(`${checks} comparisons, ${failures} mismatches`);
process.exit(failures ? EXIT_FINDINGS : EXIT_OK);
