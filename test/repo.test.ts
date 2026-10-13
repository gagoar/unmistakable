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
// https://regexr.com/?expression=%2F%5E%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B%24%2Fm&text=0.2.0%0A0.2%0Av0.2.0
const SEMVER = /^\d+\.\d+\.\d+$/;
// The frontmatter block at the start of a Markdown file. Matches "---\nname: x\n---\n" → ("name: x"); rejects a file with no leading ---.
// https://regexr.com/?expression=%2F%5E---%5Cn%28%5B%5Cs%5CS%5D%2A%3F%29%5Cn---%5Cn%2Fm&text=---%0Aname%3A%20x%0A---%0Abody
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
// The skill name line of the frontmatter. Matches "name: asd-ste100"; rejects "name: other".
// https://regexr.com/?expression=%2F%5Ename%3A%20asd-ste100%24%2Fm&text=name%3A%20asd-ste100%0Aname%3A%20other
const SKILL_NAME = /^name: asd-ste100$/m;
// A description line of at least 40 characters. Matches "description: Use when English text must be parsed without a human"; rejects "description: short".
// https://regexr.com/?expression=%2F%5Edescription%3A%20.%7B40%2C%7D%2Fm&text=description%3A%20Use%20when%20English%20text%20must%20be%20parsed%20without%20a%20human%0Adescription%3A%20short
const SKILL_DESCRIPTION = new RegExp(`^description: .{${MIN_DESCRIPTION},}`, "m");
// A claim that the project complies with, is certified by or is endorsed by ASD. Matches "We are ASD-certified" → "ASD-certified"; rejects "not endorsed by ASD" only through the negation check.
// https://regexr.com/?expression=%2F%5Cb%28ste-compliant%7Cste100-compliant%7Cste%20100%20compliant%7Casd-certified%7Cste-certified%7Cfully%20compliant%7Cendorsed%20by%20asd%7Casd-approved%29%5Cb%2Fgim&text=We%20are%20ASD-certified%0AThe%20tool%20is%20fully%20compliant
const BANNED_CLAIM = /\b(ste-compliant|ste100-compliant|ste 100 compliant|asd-certified|ste-certified|fully compliant|endorsed by asd|asd-approved)\b/gi;
// A negation within the last 5 words before a claim. Matches "is not made, checked or "; rejects "is made, checked or ".
// https://regexr.com/?expression=%2F%28%3F%3A%5Cbnot%7C%5Cbno%7C%5Cbnever%7Cn%27t%7C%5Cbnor%29%5Cs%2B%28%3F%3A%5Cw%2B%2C%3F%5Cs%2B%29%7B0%2C4%7D%24%2Fm&text=is%20not%20made%2C%20checked%20or%20%0Ais%20made%2C%20checked%20or%20
const NEGATION = /(?:\bnot|\bno|\bnever|n't|\bnor)\s+(?:\w+,?\s+){0,4}$/;
// The sample run in the README, up to the closing fence. Matches "$ echo \"hi\" | node scripts/ste-lint.ts\nout\n```" is not needed: it matches the sample block and captures its output; rejects a block that starts with another command.
// https://regexr.com/?expression=%2F%5C%24%20echo%20%5C%22We%20spin%20up%20the%20box%3B%20it%20isn%27t%20running%5C.%5C%22%20%5C%7C%20node%20scripts%2Fste-lint%5C.ts%5Cn%28%5B%5Cs%5CS%5D%2A%3F%29%5Cn%60%60%60%2Fm&text=%24%20echo%20%22We%20spin%20up%20the%20box%3B%20it%20isn%27t%20running.%22%20%7C%20node%20scripts%2Fste-lint.ts%0Aresult%0A%60%60%60%0A%24%20echo%20hi%20%7C%20cat%0Ahi%0A%60%60%60
const README_SAMPLE = /\$ echo "We spin up the box; it isn't running\." \| node scripts\/ste-lint\.ts\n([\s\S]*?)\n```/;
// A template placeholder that names a credential. Matches "${apiKey}" and "${secretValue}"; rejects "${name}".
// https://regexr.com/?expression=%2F%5C%24%5C%7B%5B%5E%7D%5D%2A%28%3F%3Akey%7Ctoken%7Csecret%7Cpassword%7Ccredential%29%5B%5E%7D%5D%2A%5C%7D%2Fim&text=%24%7BapiKey%7D%0A%24%7BTOKEN%7D%0A%24%7Bname%7D
const CREDENTIAL_PLACEHOLDER = /\$\{[^}]*(?:key|token|secret|password|credential)[^}]*\}/i;
// A copy of the whole environment. Matches "{ ...process.env }"; rejects "process.env.PATH".
// https://regexr.com/?expression=%2F%5C.%5C.%5C.process%5C.env%5Cb%7CJSON%5C.stringify%5C%28process%5C.env%5C%29%7CObject%5C.assign%5C%28%5B%5E%29%5D%2Aprocess%5C.env%2Fm&text=%7B%20...process.env%20%7D%0Aprocess.env.PATH
const WHOLE_ENV = /\.\.\.process\.env\b|JSON\.stringify\(process\.env\)|Object\.assign\([^)]*process\.env/;
// The name of a script or a document, which the scanner reads as text. Matches "core.ts" and "index.html"; rejects "logo.png".
// https://regexr.com/?expression=%2F%5C.%28%3F%3Ats%7Cmd%7Chtml%7Cjson%7Csh%7Cyml%7Cyaml%7Ctxt%29%24%2Fm&text=core.ts%0Aindex.html%0Aicon.png
const TEXT_FILE = /\.(?:ts|md|html|json|sh|yml|yaml|txt)$/;
// The name of an image, which the scanner lets through unread. Matches "logo.png"; rejects "core.ts".
// https://regexr.com/?expression=%2F%5C.%28%3F%3Apng%7Cjpe%3Fg%7Cgif%7Cwebp%7Cico%29%24%2Fim&text=icon.png%0Acore.ts
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

// A link to a regex tester site. Matches "regex" with digits and ".com"; rejects "regular expressions".
// https://regexr.com/?expression=%2Fregex%5Cd%2B%5C.com%2Fgm&text=regex7.com%0Aregular%20expressions
const TESTER_HOST = /regex\d+\.com/;

const SELF = "test/repo.test.ts";
// A TypeScript file of the code. Matches "scripts/core.ts"; rejects "scripts/render-assets.sh".
// https://regexr.com/?expression=%2F%5E%28%3F%3Ascripts%7Ctest%7Cparity%29%5C%2F.%2A%5C.ts%24%2Fm&text=scripts%2Fcore.ts%0Ascripts%2Frender-assets.sh
const CODE_FILE = /^(?:scripts|test|parity)\/.*\.ts$/;

// This file is skipped: its own examples match the pattern.
// The scanner holds a plugin for review when a code file spells a regex tester host beside a word that names a
// credential. Tester links point to regexr.com instead.
test("code carries no flagged tester link", () => {
  files().map(({ path }) => path).filter((path) => CODE_FILE.test(path) && path !== SELF).forEach((path) => assert.ok(!TESTER_HOST.test(text(path)), `${path} has a link to a regex tester that the scan flags: use regexr.com`));
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
