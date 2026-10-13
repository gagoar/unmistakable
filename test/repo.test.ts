// Tests about the repository itself: the manifests, the skill, the docs, the size of what ships and the wording
// of the marketing copy. They hold no logic of the linter.
import assert from "node:assert/strict";
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { test } from "node:test";
import { cli, ROOT } from "./helpers.ts";

const MAX_FILE_BYTES = 5_242_880; // 5 MiB: the directory rejects a file over this size
const MAX_TEXT_BYTES = 262_144; // 256 KiB: the scanner reads a script or a document only up to this size
const MIN_DESCRIPTION = 40;
const MAGIC_BYTES = 4;
const DOS_MAGIC = "MZ";
const NEGATION_WINDOW = 60;
const TEXT_NAMES: ReadonlySet<string> = new Set(["LICENSE", "LICENSE-UPSTREAM", ".gitignore"]); // text files with no extension
const LISTING_FIELDS = ["documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl"] as const;
// The first four bytes of a native executable, as hex: ELF, and Mach-O in both byte orders and both word sizes.
const NATIVE_HEADS = {
  "7f454c46": "ELF executable",
  cffaedfe: "Mach-O executable",
  cefaedfe: "Mach-O executable",
  feedfacf: "Mach-O executable",
  feedface: "Mach-O executable",
} as const satisfies Readonly<Record<string, string>>;

// A version of three whole numbers. Matches "0.2.0"; rejects "0.2" and "v0.2.0".
const SEMVER = /^\d+\.\d+\.\d+$/;
// The frontmatter block at the start of a Markdown file. Matches "---\nname: x\n---\n" → ("name: x"); rejects a file with no leading ---.
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
// The skill name line of the frontmatter. Matches "name: asd-ste100"; rejects "name: other".
const SKILL_NAME = /^name: asd-ste100$/m;
// A description line of at least 40 characters. Matches "description: Use when English text must be parsed without a human"; rejects "description: short".
const SKILL_DESCRIPTION = new RegExp(`^description: .{${MIN_DESCRIPTION},}`, "m");
// A claim that the project complies with, is certified by or is endorsed by ASD. Matches "We are ASD-certified" → "ASD-certified"; rejects "not endorsed by ASD" only through the negation check.
const BANNED_CLAIM = /\b(ste-compliant|ste100-compliant|ste 100 compliant|asd-certified|ste-certified|fully compliant|endorsed by asd|asd-approved)\b/gi;
// A negation within the last 5 words before a claim. Matches "is not made, checked or "; rejects "is made, checked or ".
const NEGATION = /(?:\bnot|\bno|\bnever|n't|\bnor)\s+(?:\w+,?\s+){0,4}$/;
// The sample run in the README, up to the closing fence. Matches "$ echo \"hi\" | node scripts/ste-lint.ts\nout\n```" is not needed: it matches the sample block and captures its output; rejects a block that starts with another command.
const README_SAMPLE = /\$ echo "We spin up the box; it isn't running\." \| node scripts\/ste-lint\.ts\n([\s\S]*?)\n```/;
// A template placeholder that names a credential. Matches a dollar sign and braces around "apiKey" or "secretValue"; rejects the same wrapper around "name".
const CREDENTIAL_PLACEHOLDER = /\$\{[^}]*(?:key|token|secret|password|credential)[^}]*\}/i;
// A copy of the whole environment. Matches "{ ...process.env }"; rejects "process.env.PATH".
const WHOLE_ENV = /\.\.\.process\.env\b|JSON\.stringify\(process\.env\)|Object\.assign\([^)]*process\.env/;
// The name of a script or a document, which the scanner reads as text. Matches "core.ts" and "index.html"; rejects "logo.png".
const TEXT_FILE = /\.(?:ts|md|html|json|sh|yml|yaml|txt)$/;
// The name of an image, which the scanner lets through unread. Matches "logo.png"; rejects "core.ts".
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|ico)$/i;

const isText = (path: string): boolean => TEXT_FILE.test(path) || TEXT_NAMES.has(basename(path));

const text = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), "utf8");

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly skills: readonly string[];
}

// Validates the shape of a manifest read from disk, so a missing field fails here and not later.
const isManifest = (value: unknown): value is Manifest => {
  const record = value as Record<string, unknown> | null; // a JSON object is narrowed field by field below
  return typeof record === "object" && record !== null && typeof record["name"] === "string" && typeof record["version"] === "string" && typeof record["license"] === "string" && Array.isArray(record["skills"]);
};

function manifest(): Manifest {
  const parsed: unknown = JSON.parse(text(".claude-plugin", "plugin.json"));
  if (!isManifest(parsed)) throw new Error("plugin.json lacks a name, a version, a license or skills");
  return parsed;
}

// Every file of the repository outside .git and node_modules, with its size.
function files(dir = ROOT): { readonly path: string; readonly bytes: number }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === ".git" || entry.name === "node_modules" ? [] : files(path);
    return [{ path: relative(ROOT, path), bytes: statSync(path).size }];
  });
}

const head = (path: string): Buffer => {
  const fd = openSync(join(ROOT, path), "r");
  try {
    const buffer = Buffer.alloc(MAGIC_BYTES);
    readSync(fd, buffer, 0, MAGIC_BYTES, 0);
    return buffer;
  } finally {
    closeSync(fd);
  }
};

test("the plugin manifest", () => {
  const plugin = manifest();
  assert.equal(plugin.name, "unmistakable");
  assert.match(plugin.version, SEMVER);
  assert.equal(plugin.license, "MIT");
  plugin.skills.forEach((skill) => assert.ok(statSync(join(ROOT, skill, "SKILL.md")).isFile(), `${skill} has no SKILL.md`));
  const listing: unknown = JSON.parse(text(".claude-plugin", "plugin.json"));
  LISTING_FIELDS.forEach((field) => assert.ok((listing as Record<string, unknown>)[field], `plugin.json lacks ${field}`)); // read as a plain record: the fields are optional
  const market: { readonly plugins: readonly { readonly name: string; readonly source: string }[] } = JSON.parse(text(".claude-plugin", "marketplace.json"));
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [[plugin.name, "./"]]);
});

test("the listing links lead to sections that exist", () => {
  const readme = text("README.md");
  assert.ok(readme.includes("## Privacy") && readme.includes("## Terms"), "the README needs the Privacy and Terms sections that the listing links to");
});

// The footer of every page in docs/ shows the version in plugin.json.
test("the footers of the docs show the plugin version", () => {
  const want = `unmistakable v${manifest().version}`;
  const pages = readdirSync(join(ROOT, "docs")).filter((name) => name.endsWith(".html"));
  assert.ok(pages.length);
  pages.forEach((page) => assert.ok(text("docs", page).includes(want), `${page}: the footer must show ${want}`));
});

test("the skill", () => {
  const skill = text("skills", "asd-ste100", "SKILL.md");
  const frontmatter = FRONTMATTER.exec(skill)?.[1] ?? "";
  assert.ok(SKILL_NAME.test(frontmatter), "the skill keeps the name asd-ste100: pr-brief invokes it by that name");
  assert.ok(SKILL_DESCRIPTION.test(frontmatter), "the skill needs a description");
  assert.ok(skill.includes("scripts/ste-lint.ts"), "SKILL.md must tell the reader to run scripts/ste-lint.ts");
  const mentions = files(join(ROOT, "skills")).filter((f) => text(relative(ROOT, f.path)).includes("ste-lint.py"));
  assert.deepEqual(mentions, [], "the skill must not mention the Python linter, which this plugin does not ship");
});

// ASD owns the ASD-STE100 mark and does not endorse tools. The marketing copy must not claim otherwise. The skill is left
// out: it states, as a non-goal, that it does not produce STE-compliant documents.
test("no claim of compliance, certification or endorsement", () => {
  const targets = ["README.md", ...readdirSync(join(ROOT, "docs")).filter((n) => n.endsWith(".html")).map((n) => join("docs", n)), join(".claude-plugin", "plugin.json"), join(".claude-plugin", "marketplace.json")];
  targets.forEach((target) => {
    const body = text(target);
    [...body.matchAll(BANNED_CLAIM)]
      .filter((m) => !NEGATION.test(body.slice(Math.max(0, (m.index ?? 0) - NEGATION_WINDOW), m.index).toLowerCase()))
      .forEach((m) => assert.fail(`${target} says "${m[0]}": claim no compliance, certification or endorsement`));
  });
});

// The plugin directory holds a plugin for review when a file is too big to read, when a native executable is committed,
// or when code copies the whole environment. This is the gate of typescript-patterns-enforcer, with the rules that apply.
test("what ships stays small, readable and free of native code", () => {
  const all = files();
  all.forEach(({ path, bytes }) => {
    assert.ok(bytes <= MAX_FILE_BYTES, `${path} is over 5 MiB, which the directory rejects`);
    if (isText(path)) assert.ok(bytes <= MAX_TEXT_BYTES, `${path} is over 256 KiB, which the scanner does not read in full`);
    if (!IMAGE_FILE.test(path) && !isText(path)) assert.fail(`${path} is neither text nor an image: the scanner may not be able to read it`);
    const magic = head(path);
    const native = (NATIVE_HEADS as Readonly<Record<string, string>>)[magic.toString("hex")] ?? (magic.subarray(0, DOS_MAGIC.length).toString("latin1") === DOS_MAGIC ? "Windows executable" : undefined); // the table is `as const`; the cast only widens the key
    assert.equal(native, undefined, `${path} is a ${native}: the scanner cannot read it`);
  });
  assert.ok(!all.some(({ path }) => path.startsWith("bin/")), "a top-level bin/ directory stops the plugin installing on Cowork and claude.ai");
  all.filter(({ path }) => path.startsWith("scripts/") && path.endsWith(".ts")).forEach(({ path }) => {
    const source = text(path);
    assert.ok(!WHOLE_ENV.test(source), `${path} copies the whole environment: read named variables instead`);
    assert.ok(!CREDENTIAL_PLACEHOLDER.test(source), `${path} has a template placeholder that names a credential`);
  });
});

// The host of a regex tester site. Matches "regex7.com" and "regexr.com"; rejects "regular expressions".
const TESTER_HOST = /regex(?:\d+|r)\.com/;
const SELF = "test/repo.test.ts";
// A TypeScript file of the code. Matches "scripts/core.ts"; rejects "scripts/render-assets.sh".
const CODE_FILE = /^(?:scripts|test|parity)\/.*\.ts$/;
// A named regex at the top level of a file. Matches "const SEMVER = /^a$/;" → ("SEMVER"); rejects "const x = 1;".
const REGEX_DECLARATION = /^(?:export )?const (\w+)(?:: RegExp)? = \//gm;
// A row of REGEXES.md. Matches "| `scripts/core.ts` | `SEMVER` |" → ("scripts/core.ts", "SEMVER"); rejects a heading.
const REGEX_ROW = /^\| `([^`]+)` \| `([^`]+)` \|/gm;

// The scanner holds a plugin for review when a code file has a remote URL beside a word that names a credential.
// So no code file carries a tester link: they live in REGEXES.md, which has no code. This file is skipped, because
// its own examples match the host pattern.
test("code carries no tester link, and REGEXES.md lists every regex", () => {
  const sources = files().map(({ path }) => path).filter((path) => CODE_FILE.test(path));
  sources.filter((path) => path !== SELF).forEach((path) => assert.ok(!TESTER_HOST.test(text(path)), `${path} has a tester link: put it in REGEXES.md`));
  const rows = new Set([...text("REGEXES.md").matchAll(REGEX_ROW)].map((match) => `${match[1]}:${match[2]}`));
  const declared = sources.flatMap((path) => [...text(path).matchAll(REGEX_DECLARATION)].map((match) => `${path}:${match[1]}`));
  declared.forEach((entry) => assert.ok(rows.has(entry), `${entry} has no row in REGEXES.md`));
  rows.forEach((entry) => assert.ok(sources.some((path) => entry.startsWith(`${path}:`)), `${entry} names a file that does not exist`));
});

test("the package declares no dependency", () => {
  const pkg: Record<string, unknown> = JSON.parse(text("package.json"));
  assert.deepEqual([pkg["dependencies"], pkg["devDependencies"], pkg["type"]], [undefined, undefined, "module"]);
});

// The sample output in the README is the real output of the script. Nobody edits it by hand.
test("the README sample is real output", () => {
  const sample = README_SAMPLE.exec(text("README.md"))?.[1];
  assert.ok(sample, "the README has no linter sample");
  const result = cli([], "We spin up the box; it isn't running.\n");
  assert.equal(sample, result.out);
});
