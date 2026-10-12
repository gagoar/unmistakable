import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/ste-lint.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface CliResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

// Runs the CLI in process. Returns the exit code and what it printed.
export function cli(args: readonly string[], stdin = ""): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, { stdin: () => stdin, out: (text) => out.push(text), err: (text) => err.push(text) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
