// The report of a run: counts, the JSON of the Python script, and the plain-text form.
import { Level, type Violation } from "./core.ts";
import { jsonString, pyFloat, pyRound1 } from "./pytext.ts";

const PERCENT = 100;

export interface Report {
  readonly violations: readonly Violation[];
  readonly count: number;
  readonly hard_count: number;
  readonly baseline: number;
  readonly words: number;
  readonly per_100_words: number;
}

export function summarize(violations: readonly Violation[], words: number, baseline: number): Report {
  const hard = violations.filter((v) => v.level === Level.Hard).length;
  const rate = words ? pyRound1((violations.length * PERCENT) / words) : 0;
  return { violations, count: violations.length, hard_count: hard, baseline, words, per_100_words: rate };
}

export const failed = (report: Report): boolean => report.hard_count > report.baseline;

// Merges the reports of several files the way the Python script does: findings in argument order, words summed.
export const merge = (baseline: number, reports: readonly Report[]): Report =>
  summarize(
    reports.flatMap((r) => r.violations),
    reports.reduce((sum, r) => sum + r.words, 0),
    baseline,
  );

// The keys of a violation in the order of the Python script. `spec` comes last, and only when it is set.
const FIELDS = ["file", "line", "col", "rule", "level", "match", "message", "spec"] as const satisfies readonly (keyof Violation)[];

const field = (v: Violation, name: (typeof FIELDS)[number]): string | undefined => {
  const value = v[name];
  if (value === undefined) return undefined;
  return `      "${name}": ${typeof value === "number" ? value : jsonString(value)}`;
};

const violationJSON = (v: Violation): string => `    {\n${FIELDS.flatMap((name) => field(v, name) ?? []).join(",\n")}\n    }`;

// json.dumps(report, indent=2): the same bytes as the Python script when no violation has a spec.
export function toJSON(report: Report): string {
  const list = report.violations.length ? `[\n${report.violations.map(violationJSON).join(",\n")}\n  ]` : "[]";
  return [
    `{\n  "violations": ${list}`,
    `,\n  "count": ${report.count}`,
    `,\n  "hard_count": ${report.hard_count}`,
    `,\n  "baseline": ${report.baseline}`,
    `,\n  "words": ${report.words}`,
    `,\n  "per_100_words": ${pyFloat(report.per_100_words)}\n}`,
  ].join("");
}

export function toText(report: Report): string {
  const lines = report.violations.map((v) => `${v.file}:${v.line}:${v.col} ${v.spec ? `${v.rule} (${v.spec})` : v.rule}: ${v.message} [${v.match}]`);
  const summary = `${report.count} violations (${report.hard_count} hard, baseline ${report.baseline}), ${report.words} words, ${pyFloat(report.per_100_words)} per 100 words`;
  return [...lines, "", summary, "Hedges/modality (may, might, could) are never flagged: confidence is content."].join("\n");
}
