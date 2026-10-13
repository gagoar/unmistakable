// The checks of the original ste-lint.py (github.com/danyuchn/asd-ste100-skill, MIT), in TypeScript.
// With no profile, the output is the output of the Python script, byte for byte. See UPSTREAM.md.
import { chars, lstrip, normalize, splitLines, strip, wordCount } from "./pytext.ts";

export const Level = { Hard: "advisory-free", Advisory: "advisory" } as const;
export type Level = (typeof Level)[keyof typeof Level];

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly rule: string;
  readonly level: Level;
  readonly match: string;
  readonly message: string;
  readonly spec?: string;
}

export interface LintResult {
  readonly findings: readonly Violation[];
  readonly words: number;
}

interface Rule {
  readonly id: string;
  readonly level: Level;
  readonly pattern: RegExp;
  readonly message: string;
  readonly skipAfterModal?: true; // "may have failed" is a hedge, not a compound tense
}

const MAX_WORDS = 25;
const NOT_FOUND = -1;
const EVEN = 2;
const DANGLING_MESSAGE = "List item ends with a coordinating conjunction. Complete the item or join it with the next item.";

const IRREGULAR_PARTICIPLES = "given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put|cut|hit|let|shut|split|spread|begun|become|come|gone|got|gotten|lost|met|paid|said|sold|told|thought|brought|bought|caught|taught|won|worn|torn|born|drawn|grown|thrown|flown|driven|risen|chosen|broken|spoken|frozen|hidden|ridden|forgotten|fallen|eaten|beaten|understood|stood|struck|stuck|swung|hung|led|fed|bled|fled|sped|bound|wound|dug|spun|slid|bit|lit|quit";
const PASSIVE_PARTICIPLES = "given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put";

// A modal verb, with an optional negation, that ends the text before a match. Matches "The task may not " and "It couldn't "; rejects "The task has ".
const MODAL_PERFECT_PREFIX = /\b(?:may|might|could|should|would|must|can|will|shall)(?:\s+not|n['’]t)?\s+$/i;
// A semicolon. Matches "a; b" → ";"; rejects "a, b".
const SEMICOLON = /;/g;
// A soft phrasal verb from a short list. Matches "We spin up the job" → "spin up"; rejects "We start the job".
const PHRASAL_VERB = /\b(spin(?:ning|s)? up|spun up|reach(?:ing|es|ed)? out|div(?:e|es|ing|ed) into|dove into|kick(?:ing|s|ed)? off|circl(?:e|es|ing|ed) back|touch(?:ing|es|ed)? base)\b/gi;
// A marketing adjective from a short list. Matches "a seamless fit" → "seamless"; rejects "a close fit".
const MARKETING = /\b(seamless(?:ly)?|robust(?:ly)?|cutting-edge|effortless(?:ly)?|blazing[- ]fast|world-class|state-of-the-art|game-chang(?:ing|er))\b/gi;
// A light verb plus a noun made from an action. Matches "Perform an analysis" → "Perform an analysis"; rejects "Analyze the log".
const NOMINALIZATION = /\b(perform|performs|performed|conduct|conducts|conducted|carry out|carries out|carried out)\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b/gi;

// A form of be and then a past participle, unless the participle leads into to, for or by and an -ing word. Matches "The panel is removed" → "is removed"; rejects "The tool is used for parsing".
const PASSIVE = new RegExp(String.raw`\b(is|are|was|were|been|being)\s+(\w+ed|${PASSIVE_PARTICIPLES})\b(?!\s+(?:to|for|by)\s+\w+ing)`, "gi");

// Has, have or had and then a past participle, unless a modal verb comes first. Matches "We have received it" → "have received"; rejects "It may have failed".
const PERFECT = new RegExp(
  String.raw`(?<!\bmay )(?<!\bmight )(?<!\bcould )(?<!\bshould )(?<!\bwould )(?<!\bmust )\b(has|have|had)\s+(?:been\s+)?(?:\w+(?:ed|en)|${IRREGULAR_PARTICIPLES})\b`,
  "gi",
);

const RULES: readonly Rule[] = [
  { id: "semicolon", level: Level.Hard, pattern: SEMICOLON, message: "STE bans the semicolon (Rule 8.1). Split into separate sentences." },
  { id: "phrasal-verb", level: Level.Hard, pattern: PHRASAL_VERB, message: "Soft phrasal verb. Use the single plain verb (start, contact, read, begin)." },
  { id: "marketing-adjective", level: Level.Hard, pattern: MARKETING, message: "Marketing adjective. Delete, or replace with the measurement that earns the claim." },
  { id: "nominalization", level: Level.Hard, pattern: NOMINALIZATION, message: "Action frozen into a noun. Use the verb (analyze, not perform an analysis of)." },
  { id: "passive-voice", level: Level.Advisory, pattern: PASSIVE, message: "Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant." },
  { id: "present-perfect", level: Level.Advisory, pattern: PERFECT, skipAfterModal: true, message: "Compound tense. Use simple past/present unless current relevance is the point (then keep and flag)." },
];

// One word, one meaning: verbs that are commonly rotated for the same action.
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["check", "verify", "confirm", "validate"],
  ["delete", "remove", "erase"],
  ["start", "launch", "begin", "initiate"],
  ["stop", "halt", "terminate"],
  ["show", "display"],
  ["use", "utilize", "employ"],
  ["fix", "repair", "correct"],
  ["send", "transmit"],
  ["get", "retrieve", "fetch", "obtain"],
  ["change", "modify", "alter"],
];

// A line that opens or closes a fenced code block. Matches "```ts" and "~~~"; rejects "``x``".
const CODE_FENCE = /^(```|~~~)/;
// A code span between backticks. Matches "use `x` here" → "`x`"; rejects "use x here".
const INLINE_CODE = /`[^`]*`/g;
// The start of a Markdown list item: 0 to 3 spaces, a marker, spaces, then the text. Matches "  - a and" → ("  ", "-", " ", "a and"); rejects "    - code" and "-text".
const LIST_ITEM_START = /^( {0,3})([-*+]|[0-9]+[.)])( +)(.*)$/;
// A line that ends with and or or. Matches "Start the task and" → "and"; rejects "Start the task.".
const CONJUNCTION_END = /\b(?:and|or)\s*$/i;
// A Markdown table separator cell: 3 or more dashes, with optional colons. Matches "---" and ":--:"; rejects "--" and "a-b".
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;
// A pipe that no backslash escapes. Splits "a|b" into "a" and "b"; "a\|b" is not split.
const UNESCAPED_PIPE = /(?<!\\)\|/;
// A pipe at the end of a table row. Replaced with nothing: "a|b|" → "a|b"; "a|b" is unchanged.
const TRAILING_PIPE = /\|$/;
// Spaces at the start of a line (not tabs). Matches "  x" → "  "; rejects "x" and "\tx".
const ASCII_LEADING_SPACES = /^ +/;
// The white space after a . ! or ?. Splits "One. Two" into "One." and "Two"; "One two" is not split.
const SENTENCE_GAP = /(?<=[.!?])[\t-\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

export { CODE_FENCE, INLINE_CODE };

// A verb of a synonym group, with its endings; here the group member check. Matches "Checking the log" → "Checking"; rejects "Checkpoint".
const synonymPattern = (base: string): RegExp => new RegExp(String.raw`\b${base}(?:s|es|ed|d|ing)?\b`, "i");
const SYNONYM_RES: ReadonlyMap<string, RegExp> = new Map(SYNONYM_GROUPS.flat().map((base) => [base, synonymPattern(base)]));

const cmp = (a: string, b: string): number => Number(a > b) - Number(a < b);
const leadingSpaces = (line: string): number => line.length - line.replace(ASCII_LEADING_SPACES, "").length;

interface Match {
  readonly index: number;
  readonly text: string;
}

// RegExpMatchArray.index is optional in the types and always set for matchAll.
const matchesOf = (pattern: RegExp, text: string): Match[] => [...text.matchAll(pattern)].map((m) => ({ index: m.index ?? 0, text: m[0] }));

// Whether each line opens or closes a code fence, or sits inside one.
export const LineKind = { Fence: "fence", Code: "code", Text: "text" } as const;
export type LineKind = (typeof LineKind)[keyof typeof LineKind];

export function lineKinds(lines: readonly string[]): LineKind[] {
  const fencesThrough = lines.reduce<number[]>((counts, line) => {
    counts.push((counts.at(-1) ?? 0) + Number(CODE_FENCE.test(strip(line))));
    return counts;
  }, []);
  return lines.map((line, i): LineKind => {
    if (CODE_FENCE.test(strip(line))) return LineKind.Fence;
    return (fencesThrough[i] ?? 0) % EVEN === 1 ? LineKind.Code : LineKind.Text;
  });
}

function isListContinuation(line: string, contentIndent: number): boolean {
  if (!strip(line)) return true;
  if (LIST_ITEM_START.test(line)) return false;
  return leadingSpaces(line) >= contentIndent;
}

type Cell = readonly [text: string, column: number];

const leadingLength = (text: string): number => chars(text).length - chars(lstrip(text)).length;

// Trimmed cells of a Markdown table row, with the source column of each. undefined when the line is not a row.
function splitTableRow(line: string): Cell[] | undefined {
  const trimmed = strip(line);
  if (!trimmed.includes("|")) return undefined;
  const opensWithPipe = trimmed.startsWith("|");
  const raw = trimmed.slice(Number(opensWithPipe)).replace(TRAILING_PIPE, "").split(UNESCAPED_PIPE);
  if (raw.length <= 1) return undefined;
  const firstColumn = leadingLength(line) + Number(opensWithPipe);
  const widths = raw.map((piece) => chars(piece).length + 1);
  return raw.map((piece, i): Cell => [strip(piece), firstColumn + widths.slice(0, i).reduce((sum, w) => sum + w, 0) + leadingLength(piece)]);
}

type Entry = readonly [number, readonly Cell[]];

interface TableScan {
  readonly resume: number;
  readonly cells: ReadonlyMap<number, readonly Cell[]>;
}

// Maps each row of an ordinary Markdown table to its cells. The separator row anchors the detection, so prose that
// holds a pipe is not a table. A separator row maps to no cells, so no text is read from it.
function markdownTableCells(lines: readonly string[]): ReadonlyMap<number, readonly Cell[]> {
  const rows = lines.map(splitTableRow);
  const scan = rows.reduce<TableScan>(
    (state, separator, index) => {
      const header = rows[index - 1];
      const isTable = index >= state.resume && index > 0 && separator && header && separator.length === header.length && separator.every(([text]) => TABLE_SEPARATOR_CELL.test(text));
      if (!isTable || !separator || !header) return state;
      const end = rows.findIndex((row, k) => k > index && (!row || row.length !== separator.length));
      const stop = end === NOT_FOUND ? lines.length : end;
      const body = rows.slice(index + 1, stop).map((row, k): Entry => [index + 1 + k, row ?? []]);
      const entries: Entry[] = [[index - 1, header], [index, []], ...body];
      return { resume: stop, cells: new Map([...state.cells, ...entries]) };
    },
    { resume: 0, cells: new Map() },
  );
  return scan.cells;
}

interface ItemLine {
  readonly index: number;
  readonly text: string;
}

interface ListScan {
  readonly resume: number;
  readonly inFence: boolean;
  readonly found: readonly Violation[];
}

// A list item ends at the first line that neither continues it nor sits in a fence that it opened.
function danglingConjunctionFindings(lines: readonly string[], filename: string): Violation[] {
  const isFence = lines.map((line) => CODE_FENCE.test(strip(line)));
  const fenceOpenAt = (from: number, k: number): boolean => isFence.slice(from + 1, k).filter(Boolean).length % EVEN === 1;
  const scan = lines.reduce<ListScan>(
    (state, line, index) => {
      if (index < state.resume) return state;
      const next: ListScan = { ...state, resume: index + 1 };
      if (isFence[index]) return { ...next, inFence: !state.inFence };
      const start = state.inFence ? null : LIST_ITEM_START.exec(line);
      if (!start) return next;
      const [, indent = "", marker = "", gap = "", body = ""] = start;
      const contentIndent = indent.length + marker.length + gap.length;
      const end = lines.findIndex((candidate, k) => k > index && !isFence[k] && !fenceOpenAt(index, k) && !isListContinuation(candidate, contentIndent));
      const stop = end === NOT_FOUND ? lines.length : end;
      const items: ItemLine[] = [
        { index, text: body },
        ...lines.slice(index + 1, stop).flatMap((text, k) => (isFence[index + 1 + k] || fenceOpenAt(index, index + 1 + k) ? [] : [{ index: index + 1 + k, text }])),
      ];
      const meaningful = items.map((item) => ({ index: item.index, text: strip(item.text.replace(INLINE_CODE, " CODE ")) })).filter((item) => item.text);
      const last = meaningful.at(-1);
      if (!last || !CONJUNCTION_END.test(normalize(chars(last.text)))) return { ...next, resume: stop };
      return { resume: stop, inFence: state.inFence, found: [...state.found, danglingFinding(items, last, index, indent.length, filename)] };
    },
    { resume: 0, inFence: false, found: [] },
  );
  return [...scan.found];
}

function danglingFinding(items: readonly ItemLine[], last: ItemLine, firstIndex: number, indent: number, filename: string): Violation {
  const rawLine = items.find((item) => item.index === last.index)?.text ?? "";
  const masked = normalize(chars(rawLine.replace(INLINE_CODE, (span) => " ".repeat(chars(span).length))));
  const hit = CONJUNCTION_END.exec(masked);
  const col = last.index === firstIndex ? indent + 1 : (hit?.index ?? 0) + 1;
  return { file: filename, line: last.index + 1, col, rule: "dangling-conjunction", level: Level.Hard, match: last.text, message: DANGLING_MESSAGE };
}

// re.split(r"(?<=[.!?])\s+", line): split at each run of white space that follows . ! or ?
export const splitSentences = (line: string): string[] => line.split(SENTENCE_GAP);

interface Segment {
  readonly lineno: number;
  readonly col: number;
  readonly line: string;
  readonly orig: readonly string[];
  readonly norm: string;
}

const slice = (seg: Segment, m: Match): string => seg.orig.slice(m.index, m.index + m.text.length).join("");

function ruleFindings(seg: Segment, filename: string): Violation[] {
  return RULES.flatMap((rule) =>
    matchesOf(rule.pattern, seg.norm)
      .filter((m) => !(rule.skipAfterModal && MODAL_PERFECT_PREFIX.test(seg.norm.slice(0, m.index))))
      .map((m): Violation => ({ file: filename, line: seg.lineno, col: seg.col + m.index + 1, rule: rule.id, level: rule.level, match: slice(seg, m), message: rule.message })),
  );
}

function longSentenceFindings(seg: Segment, filename: string): Violation[] {
  return splitSentences(seg.line)
    .map(wordCount)
    .filter((n) => n > MAX_WORDS)
    .map((n): Violation => ({ file: filename, line: seg.lineno, col: seg.col + 1, rule: "long-sentence", level: Level.Hard, match: `${n} words`, message: `Sentence has ${n} words (cap ${MAX_WORDS}). Split it.` }));
}

interface SynonymHit {
  readonly line: number;
  readonly col: number;
  readonly match: string;
  readonly base: string;
}

// The first place each member of a group appears, then a finding for every member after the first one in the text.
function synonymFindings(segments: readonly Segment[], filename: string): Violation[] {
  const firstHit = (base: string): SynonymHit | undefined => {
    const pattern = SYNONYM_RES.get(base);
    const seg = pattern && segments.find((s) => pattern.test(s.norm));
    const m = seg && pattern ? firstMatch(pattern, seg.norm) : undefined;
    return seg && m ? { line: seg.lineno, col: seg.col + m.index + 1, match: slice(seg, m), base } : undefined;
  };
  return SYNONYM_GROUPS.flatMap((group) => {
    const present = group.flatMap((base) => firstHit(base) ?? []);
    if (present.length <= 1) return [];
    const ordered = [...present].sort((a, b) => a.line - b.line || a.col - b.col || cmp(a.match, b.match) || cmp(a.base, b.base));
    const first = ordered[0]?.base ?? "";
    return ordered.slice(1).map((h): Violation => ({ file: filename, line: h.line, col: h.col, rule: "synonym-rotation", level: Level.Hard, match: h.match, message: `'${h.base}' and '${first}' name the same action. Pick one and use it every time.` }));
  });
}

const firstMatch = (pattern: RegExp, text: string): Match | undefined => {
  const m = pattern.exec(text);
  return m ? { index: m.index, text: m[0] } : undefined;
};

// Returns the findings and the word count, in the order of the Python script.
export function lint(text: string, filename = "<stdin>"): LintResult {
  const lines = splitLines(text);
  const kinds = lineKinds(lines);
  const tableCells = markdownTableCells(lines);
  const segments = lines.flatMap((raw, i): Segment[] => {
    if (kinds[i] !== LineKind.Text) return [];
    return (tableCells.get(i) ?? [[raw, 0] as const]).map(([cell, col]) => {
      const line = cell.replace(INLINE_CODE, "");
      const orig = chars(line);
      return { lineno: i + 1, col, line, orig, norm: normalize(orig) };
    });
  });
  const words = segments.reduce((sum, seg) => sum + wordCount(seg.line), 0);
  const all = [
    ...segments.flatMap((seg) => [...ruleFindings(seg, filename), ...longSentenceFindings(seg, filename)]),
    ...synonymFindings(segments, filename),
    ...danglingConjunctionFindings(lines, filename),
  ];
  return { findings: all.sort((a, b) => a.line - b.line || a.col - b.col), words }; // sort is stable
}
