// The command line of ste-lint: arguments in, a report and an exit code out. scripts/ste-lint.ts is the entry point.
import { readFileSync } from "node:fs";
import { failed, lintText, merge, PROFILES, toJSON, toText, type LintOptions, type Profile, type Report } from "./stelint.ts";

const VERSION = "0.2.1";
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;
const STDIN = 0;

const USAGE = `usage: ste-lint [--profile agent|descriptive|procedure|upstream] [--json] [--baseline N] [--disable rule,rule] [FILE...]
       ste-lint version

Reads FILE arguments, or stdin when there are none. Exit 0 when the hard violations do not
exceed the baseline (default 0), 1 when they do, 2 for a usage error.

The profile picks the rules (default agent):
  agent        every check, for text that an AI agent reads
  descriptive  the checks that follow a numbered STE rule, 25 words per sentence
  procedure    descriptive, with 20 words per sentence
  upstream     exactly the checks of the original ste-lint.py, with its output byte for byte`;

class UsageError extends Error {}

interface Options {
  readonly json: boolean;
  readonly help: boolean;
  readonly baseline: number;
  readonly disable: readonly string[];
  readonly profile: Profile;
  readonly paths: readonly string[];
}

const DEFAULTS: Options = { json: false, help: false, baseline: 0, disable: [], profile: "agent", paths: [] };

// A flag that takes a value reads the next argument and returns the options with it applied.
type ValueFlag = (value: string, options: Options) => Options;

const isProfile = (value: string): value is Profile => (PROFILES as readonly string[]).includes(value);

const VALUE_FLAGS: Readonly<Record<string, ValueFlag>> = {
  "--baseline": (value, options) => {
    if (!WHOLE_NUMBER.test(value)) throw new UsageError(`--baseline needs a whole number, not "${value}"`);
    return { ...options, baseline: Number(value) };
  },
  "--disable": (value, options) => ({ ...options, disable: value.split(",") }),
  "--profile": (value, options) => {
    if (!isProfile(value)) throw new UsageError(`unknown profile "${value}"`);
    return { ...options, profile: value };
  },
};

const SWITCHES: Readonly<Record<string, (options: Options) => Options>> = {
  "--json": (options) => ({ ...options, json: true }),
  "-h": (options) => ({ ...options, help: true }),
  "--help": (options) => ({ ...options, help: true }),
};

function parse(argv: readonly string[], options: Options = DEFAULTS): Options {
  const [arg, ...rest] = argv;
  if (arg === undefined) return options;
  const valueFlag = VALUE_FLAGS[arg];
  if (valueFlag) {
    const [value, ...after] = rest;
    if (value === undefined) throw new UsageError(`${arg} needs a value`);
    return parse(after, valueFlag(value, options));
  }
  const toggle = SWITCHES[arg];
  if (toggle) return parse(rest, toggle(options));
  if (arg.startsWith("--")) throw new UsageError(`unknown flag ${arg}`);
  return parse(rest, { ...options, paths: [...options.paths, arg] });
}

// A whole number. Matches "12"; rejects "-1" and "x".
// https://regexr.com/?expression=%2F%5E%5Cd%2B%24%2Fm&text=12%0A-1%0Ax
const WHOLE_NUMBER = /^\d+$/;

// The Python script reads in text mode, so a line break is one "\n" whatever the file used.
const universalNewlines = (text: string): string => text.replace(CR_LF, "\n");

// A carriage return, with or without a line feed. Replaced by "\n": "a\r\nb" → "a\nb"; "a\nb" is unchanged.
// https://regexr.com/?expression=%2F%5Cr%5Cn%3F%2Fgm&text=a%0D%0Ab%0Aa%0Ab
const CR_LF = /\r\n?/g;

export interface Io {
  readonly stdin: () => string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const SYSTEM_IO: Io = {
  stdin: () => readFileSync(STDIN, "utf8"),
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

function report(options: Options, io: Io): Report {
  const settings: LintOptions = { profile: options.profile, disable: options.disable, baseline: options.baseline };
  if (!options.paths.length) return lintText(universalNewlines(io.stdin()), settings);
  return merge(options.baseline, options.paths.map((path) => lintText(universalNewlines(readFileSync(path, "utf8")), { ...settings, filename: path })));
}

export function run(argv: readonly string[], io: Io = SYSTEM_IO): number {
  if (argv.length === 1 && argv[0] === "version") {
    io.out(VERSION);
    return EXIT_OK;
  }
  try {
    const options = parse(argv);
    if (options.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const result = report(options, io);
    io.out(options.json ? toJSON(result) : toText(result));
    return failed(result) ? EXIT_FINDINGS : EXIT_OK;
  } catch (error) {
    io.err(error instanceof UsageError ? `ste-lint: ${error.message}\n${USAGE}` : `ste-lint: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}
