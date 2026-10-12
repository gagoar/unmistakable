// The public API: lint text under a profile and get a report.
import { lint, type Violation } from "./core.ts";
import { extend, isExtended, type Profile } from "./extended.ts";
import { summarize, type Report } from "./report.ts";

export { EXTRA_SPEC, PROFILES, Profile, SPEC_OF, specOf } from "./extended.ts";
export { failed, merge, summarize, toJSON, toText, type Report } from "./report.ts";
export { Level, type Violation } from "./core.ts";

export interface LintOptions {
  readonly filename?: string;
  readonly profile?: Profile;
  readonly disable?: readonly string[];
  readonly baseline?: number;
}

// With no profile, or the profile "upstream", the checks and the output are those of the Python script.
export function lintText(text: string, { filename = "<stdin>", profile, disable = [], baseline = 0 }: LintOptions = {}): Report {
  const { findings, words } = lint(text, filename);
  const all: readonly Violation[] = isExtended(profile) && profile ? extend(findings, text, filename, profile) : findings;
  return summarize(all.filter((f) => !disable.includes(f.rule)), words, baseline);
}
