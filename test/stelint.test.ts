import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EXTRA_SPEC, lintText, type LintOptions, type Profile, type Report } from "../scripts/stelint.ts";
import { ROOT } from "./helpers.ts";

const upstream = (text: string, options: LintOptions = {}): Report => lintText(text, { profile: "upstream", ...options });
const rulesOf = (report: Report): string[] => report.violations.map((v) => v.rule);
const count = (report: Report, rule: string): number => rulesOf(report).filter((r) => r === rule).length;
const fixture = (name: string): string => readFileSync(join(ROOT, "testdata", "rules", name), "utf8");
const repeat = (word: string, times: number): string => `${Array.from({ length: times }, () => word).join(" ")}.`;

const WORDS_WITHIN_PROCEDURE_LIMIT = 22;
const TERMS_IN_CELL = 24;
const TABLE_LABEL_WORDS = 3; // Label, Detail and Clear: the words of the table outside the cell
const BASELINE = 3;
const INDENTED_COLUMN = 4;
const TWICE = 2;
const THRICE = 3;
const Times = { none: 0, once: 1, twice: TWICE, thrice: THRICE } as const;
const WORDS_OVER_DESCRIPTIVE_LIMIT = 26;
const MODALS = ["may", "might", "could", "should", "would", "must"] as const;
const GAPS = [" ", "  ", "\t", " not "] as const;
const EVERY_RULE = ["semicolon", "phrasal-verb", "nominalization", "marketing-adjective", "passive-voice", "present-perfect"] as const;

test("upstream selftest: every rule fires", () => {
  const report = upstream("The panel is removed; spin up the job. Perform an analysis of the seamless log. We have received the report.");
  EVERY_RULE.forEach((id) => assert.ok(rulesOf(report).includes(id), id));
});

test("upstream selftest: hedges are never flagged", () => {
  assert.deepEqual(upstream("The request may have failed. It could be a timeout. The disk might have filled.").violations, []);
  MODALS.forEach((modal) => GAPS.forEach((gap) => assert.equal(count(upstream(`The task ${modal}${gap}have run.`), "present-perfect"), 0, `${modal}${JSON.stringify(gap)}`)));
  assert.equal(count(upstream("The task couldn't have run. The task MAY NOT HAVE RUN."), "present-perfect"), 0);
});

// Each row: the text, the rule, and how many times the rule fires.
const COUNTS: readonly (readonly [text: string, rule: string, times: number])[] = [
  ["The task has run. The job has set the flag. We have begun.", "present-perfect", Times.thrice],
  ["The task has run. We have begun. The flag is set.", "present-perfect", Times.twice],
  ["The task has run. We have begun. The flag is set.", "passive-voice", Times.once],
  ["The task is gone.", "passive-voice", Times.none],
  ["Check the config. Check the output.", "synonym-rotation", Times.none],
  ["  - Confirm the target and\n    record the result.", "dangling-conjunction", Times.none],
  ["    - code and", "dangling-conjunction", Times.none],
  ["> - Confirm the target and\n> - Record the result or", "dangling-conjunction", Times.none],
  ["```text\n- code and\n```", "dangling-conjunction", Times.none],
  ["- Use `and` as a label", "dangling-conjunction", Times.none],
  ["- Combine `left` and `right`", "dangling-conjunction", Times.none],
  ["- Start the task and.\n- Stop the task or,", "dangling-conjunction", Times.none],
  ["- Start the task and\n\n  record the result.", "dangling-conjunction", Times.none],
  ["The process may include steps and", "dangling-conjunction", Times.none],
  ["```\nx = a; y = b\n```", "semicolon", Times.none],
];

test("upstream selftest: how many times a rule fires", () => {
  COUNTS.forEach(([text, rule, times]) => assert.equal(count(upstream(text), rule), times, `${JSON.stringify(text)} ${rule}`));
});

test("upstream selftest: dangling conjunctions in lists", () => {
  const found = upstream("- Confirm the target and\n* Record the result OR  \n+ Close the panel\n1. Start the task and\n2) Stop the task OR").violations.filter((v) => v.rule === "dangling-conjunction");
  assert.deepEqual(found.map((v) => `${v.line}:${v.col}`), ["1:1", "2:1", "4:1", "5:1"]);
  assert.ok(found.every((v) => v.level === "advisory-free"));
  const nested = upstream("- Parent item and\n  - Nested item or").violations.filter((v) => v.rule === "dangling-conjunction");
  assert.deepEqual(nested.map((v) => String(v.line)), ["1", "2"]);
  const indented = upstream("   - Start the task and", { filename: "fixture.md" }).violations.find((v) => v.rule === "dangling-conjunction");
  assert.equal(indented?.col, INDENTED_COLUMN);
  assert.equal(indented?.file, "fixture.md");
  assert.ok(indented?.message.includes("Complete the item"));
});

test("upstream selftest: tables, length, synonyms, file labels", () => {
  const cell = `${Array.from({ length: TERMS_IN_CELL }, (_, i) => `term${i + 1}`).join(" ")}.`;
  const tables = [`| Label | Detail |\n| --- | --- |\n| Clear | ${cell} |`, `Label | Detail\n--- | ---\nClear | ${cell}`];
  tables.forEach((table) => {
    const report = upstream(table);
    assert.equal(count(report, "long-sentence"), 0);
    assert.equal(report.words, TABLE_LABEL_WORDS + TERMS_IN_CELL);
  });
  const long = `${Array.from({ length: WORDS_OVER_DESCRIPTIVE_LIMIT }, (_, i) => `term${i + 1}`).join(" ")}.`;
  const report = upstream(`| Label | Detail |\n| --- | --- |\n| Clear | ${long} |`);
  assert.equal(report.violations.find((v) => v.rule === "long-sentence")?.match, `${WORDS_OVER_DESCRIPTIVE_LIMIT} words`);
  assert.ok(rulesOf(upstream(repeat("word", WORDS_OVER_DESCRIPTIVE_LIMIT + 1))).includes("long-sentence"));
  const rotation = upstream("Check the config file. Then verify the output. Verify twice.").violations.filter((v) => v.rule === "synonym-rotation");
  assert.deepEqual(rotation.map((v) => v.message.includes("'verify' and 'check'")), [true]);
  assert.equal(upstream("a; b", { filename: "x.md" }).violations[0]?.file, "x.md");
});

test("every extra check has a fail fixture that fires it and a pass fixture that does not", () => {
  Object.keys(EXTRA_SPEC).forEach((id) => {
    const profile: Profile = id === "procedure-length" ? "procedure" : "agent";
    const fail = lintText(fixture(`${id}.fail.md`), { profile, filename: `${id}.fail.md` });
    assert.ok(count(fail, id), `${id}: the fail fixture does not fire it`);
    const spec = EXTRA_SPEC[id as keyof typeof EXTRA_SPEC]; // the keys come from this table
    assert.ok(fail.violations.filter((v) => v.rule === id).every((v) => v.spec === spec), `${id}: wrong spec`);
    const quiet = lintText(fixture(`${id}.pass.md`), { profile, filename: `${id}.pass.md` });
    assert.equal(count(quiet, id), 0, `${id}: the pass fixture fires it: ${JSON.stringify(quiet.violations)}`);
  });
});

test("the upstream profile adds no spec and none of the extra checks", () => {
  Object.keys(EXTRA_SPEC).forEach((id) => {
    [lintText(fixture(`${id}.fail.md`)), upstream(fixture(`${id}.fail.md`))].forEach((report) =>
      report.violations.forEach((v) => assert.ok(v.spec === undefined && !(v.rule in EXTRA_SPEC), `${id}: ${JSON.stringify(v)}`)),
    );
  });
});

test("spec labels and profiles", () => {
  const text = "The panel is removed; the job is seamless. We have received the report.\n";
  const specs = (profile: Profile): Record<string, string | undefined> => Object.fromEntries(lintText(text, { profile }).violations.map((v) => [v.rule, v.spec]));
  const agent = specs("agent");
  assert.deepEqual([agent["semicolon"], agent["passive-voice"], agent["present-perfect"], agent["marketing-adjective"]], ["STE-8.1", "STE-3.6", "STE-3.1", "X-marketing-adjective"]);
  (["descriptive", "procedure"] as const).forEach((profile) => {
    assert.ok(!("marketing-adjective" in specs(profile)), `${profile} must not run X- checks`);
    assert.equal(specs(profile)["semicolon"], "STE-8.1");
  });
  const passive = lintText("The panel is removed.", { profile: "agent" }).violations[0];
  assert.ok(!passive?.message.includes("irrelevant"), "an irrelevant actor does not allow the passive");
});

test("the procedure profile uses the 20-word limit", () => {
  const sentence = repeat("word", WORDS_WITHIN_PROCEDURE_LIMIT);
  const procedure = lintText(sentence, { profile: "procedure" });
  assert.deepEqual([count(procedure, "procedure-length"), count(procedure, "long-sentence")], [1, 0]);
  const descriptive = lintText(sentence, { profile: "descriptive" });
  assert.equal(count(descriptive, "long-sentence") + count(descriptive, "procedure-length"), 0);
  assert.equal(count(lintText(repeat("word", WORDS_OVER_DESCRIPTIVE_LIMIT), { profile: "descriptive" }), "long-sentence"), 1);
});

test("code, headings and URLs are not prose", () => {
  const text = "# Hydraulic pump pressure switch housing\n\n```\nx = isn't; colour\n```\n\nUse `colour` and https://host.invalid/colour here.\n";
  assert.deepEqual(lintText(text, { profile: "agent" }).violations, []);
});

test("hedges stay unflagged in every profile", () => {
  (["agent", "descriptive", "procedure", "upstream"] as const).forEach((profile) =>
    assert.deepEqual(lintText("The request may have failed. It could be a timeout. The disk might have filled.\n", { profile }).violations, [], profile),
  );
});

test("--disable and the baseline", () => {
  const report = lintText("a; b; c.", { profile: "upstream", disable: ["semicolon"], baseline: BASELINE });
  assert.deepEqual([report.count, report.baseline], [0, BASELINE]);
});
