// Profiles, and the checks that the original script does not have.
//
// The rule numbers are those of ASD-STE100 Issue 9 (2025). They name a rule. They do not quote it:
// the standard is copyright ASD, and none of its text is shipped here. Check a number against your
// own copy of the standard. The word lists in this file are this project's own.
import { INLINE_CODE, Level, LineKind, lineKinds, splitSentences, type Violation } from "./core.ts";
import { blankNonProse } from "./prose.ts";
import { chars, splitLines, strip, wordCount } from "./pytext.ts";

export const Profile = { Agent: "agent", Descriptive: "descriptive", Procedure: "procedure", Upstream: "upstream" } as const;
export type Profile = (typeof Profile)[keyof typeof Profile];
export const PROFILES: readonly Profile[] = Object.values(Profile);

const MAX_WORDS_PROCEDURE = 20;
const MAX_SENTENCES_IN_PARAGRAPH = 6;
const MAX_NOUN_RUN = 3;
const PREVIEW_WORDS = 3;
const EXTRA_PREFIX = "X-";
const NOT_FOUND = -1;

// The STE rule behind each upstream check. The prefix X- marks a check of this project that is not an STE
// rule: only the agent profile runs it.
export const SPEC_OF = {
  semicolon: "STE-8.1",
  "phrasal-verb": "STE-9.3",
  nominalization: "STE-3.7",
  "passive-voice": "STE-3.6",
  "present-perfect": "STE-3.1",
  "synonym-rotation": "STE-1.11",
  "long-sentence": "STE-6.3",
  "marketing-adjective": "X-marketing-adjective",
  "dangling-conjunction": "X-dangling-conjunction",
} as const satisfies Readonly<Record<string, string>>;

// The checks that only the extended profiles run.
export const EXTRA_SPEC = {
  "paragraph-length": "STE-6.6",
  contraction: "STE-4.2",
  "ing-form": "STE-3.5",
  "noun-cluster": "STE-2.1",
  "warning-start": "STE-7.2",
  "warning-risk": "STE-7.3",
  "dropped-article": "STE-4.5",
  "british-spelling": "STE-1.14",
  "procedure-length": "STE-5.1",
} as const satisfies Readonly<Record<string, string>>;

export const isExtended = (profile: Profile | undefined): boolean => profile !== undefined && profile !== Profile.Upstream;

const PASSIVE_MESSAGE = "Possible passive voice. Name the actor and use an active verb. The passive is for an actor that is unknown.";

const words = (...list: readonly string[]): ReadonlySet<string> => new Set(list);

// A contraction such as isn't or we've. Matches "It isn't" → "isn't"; rejects "It is not" and "the user's".
// https://regexr.com/?expression=%2F%5Cb%5Ba-z%5D%2B%28%3F%3An%5B%27%E2%80%99%5Dt%7C%5B%27%E2%80%99%5D%28%3F%3Are%7Cve%7Cll%7Cd%7Cm%29%29%5Cb%2Fgim&text=It%20isn%27t%0AIt%20is%20not%0Athe%20user%27s
const CONTRACTION = /\b[a-z]+(?:n['’]t|['’](?:re|ve|ll|d|m))\b/gi;
// A form of be followed by an -ing word. Matches "The pump is running" → "is running" (group "running"); rejects "The pump runs".
// https://regexr.com/?expression=%2F%5Cb%28%3F%3Ais%7Care%7Cwas%7Cwere%7Cbe%7Cbeen%29%5Cs%2B%28%5Ba-z%5D%2Bing%29%5Cb%2Fgim&text=The%20pump%20is%20running%0AThe%20pump%20runs
const ING_FORM = /\b(?:is|are|was|were|be|been)\s+([a-z]+ing)\b/gi;
// The first line of a WARNING or CAUTION block. Matches "WARNING: Do not touch" → ("WARNING", "Do not touch"); rejects "A warning sign".
// https://regexr.com/?expression=%2F%5E%5Cs%2A%28%3F%3A%3E%5Cs%2A%29%3F%28%3F%3A%5C%2A%5C%2A%29%3F%28WARNING%7CCAUTION%29%28%3F%3A%5C%2A%5C%2A%29%3F%5Cs%2A%5B%3A.%5C-%E2%80%94%5D%3F%5Cs%2A%28.%2A%29%24%2Fm&text=WARNING%3A%20Do%20not%20touch%0AA%20warning%20sign
const WARNING = /^\s*(?:>\s*)?(?:\*\*)?(WARNING|CAUTION)(?:\*\*)?\s*[:.\-—]?\s*(.*)$/;
// A word, or one character that is not a letter or a space. Splits "Open the panel." into "Open", "the", "panel", ".".
// https://regexr.com/?expression=%2F%5BA-Za-z%5D%5BA-Za-z0-9%27%E2%80%99-%5D%2A%7C%5B%5E%5CsA-Za-z%5D%2Fgm&text=Open%20the%20panel.
const WORD_TOKEN = /[A-Za-z][A-Za-z0-9'’-]*|[^\sA-Za-z]/g;
// An abbreviation whose dot does not end a sentence. Matches "e.g." and "etc."; rejects "end.".
// https://regexr.com/?expression=%2F%5Cb%28%3F%3Ae%5C.g%7Ci%5C.e%7Cetc%7Cvs%7Capprox%7Ccf%29%5C.%2Fgim&text=See%20e.g.%20this%0Aetc.%0Aend.
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|approx|cf)\./gi;
// A list marker at the start of a line. Matches "- a" and "2) b"; rejects "-a".
// https://regexr.com/?expression=%2F%5E%5Cs%2A%28%3F%3A%5B-%2A%2B%5D%7C%5B0-9%5D%2B%5B.%29%5D%29%5Cs%2B%2Fm&text=-%20a%0A2%29%20b%0A-a
const LIST_MARKER = /^\s*(?:[-*+]|[0-9]+[.)])\s+/;
// The end of a sentence: . ! or ? and then a space or the end. Matches the ends in "One. Two."; rejects "1.5 units".
// https://regexr.com/?expression=%2F%5B.%21%3F%5D%2B%28%3F%3A%5Cs%2B%7C%24%29%2Fgm&text=One.%20Two.%0A1.5%20units
const SENTENCE_END = /[.!?]+(?:\s+|$)/g;
// A token that starts with a letter. Matches "Open"; rejects "." and "7".
// https://regexr.com/?expression=%2F%5E%5BA-Za-z%5D%2Fm&text=Open%0A.%0A7
const LETTER_START = /^[A-Za-z]/;
// A token that starts with a capital letter. Matches "GitHub"; rejects "github".
// https://regexr.com/?expression=%2F%5E%5BA-Z%5D%2Fm&text=GitHub%0Agithub
const CAPITAL_START = /^[A-Z]/;
// A digit anywhere in a token. Matches "v2"; rejects "vtwo".
// https://regexr.com/?expression=%2F%5B0-9%5D%2Fm&text=v2%0Avtwo
const HAS_DIGIT = /[0-9]/;
// Punctuation at the start or the end of a word. Replaced with nothing: "panel," → "panel"; "panel" is unchanged.
// https://regexr.com/?expression=%2F%5E%5B.%2C%3A%3B%5D%2B%7C%5B.%2C%3A%3B%5D%2B%24%2Fgm&text=panel%2C%0Apanel
const EDGE_PUNCTUATION = /^[.,:;]+|[.,:;]+$/g;
// Punctuation, including ! and ?, at the start or the end of a word. Replaced with nothing: "panel!" → "panel"; "panel" is unchanged.
// https://regexr.com/?expression=%2F%5E%5B.%2C%3A%3B%21%3F%5D%2B%7C%5B.%2C%3A%3B%21%3F%5D%2B%24%2Fgm&text=panel%21%0Apanel
const EDGE_MARKS = /^[.,:;!?]+|[.,:;!?]+$/g;
// A run of white space between words. Splits "a  b" into "a" and "b"; "ab" is not split.
// https://regexr.com/?expression=%2F%5Cs%2B%2Fm&text=a%20%20b%0Aab
const WHITESPACE = /\s+/;
// A quote mark at the start of a line. Replaced with nothing: "> text" → " text"; "text" is unchanged.
// https://regexr.com/?expression=%2F%5E%3E%2Fm&text=%3E%20text%0Atext
const QUOTE_MARK = /^>/;

const NOT_ING_VERB = words("bring", "string", "thing", "king", "ring", "spring", "sing", "wing", "sting", "swing", "cling", "fling", "sling", "ceiling", "nothing", "something", "anything", "everything", "morning", "evening", "during", "missing", "following", "existing", "remaining", "matching", "corresponding", "interesting", "surprising", "amazing", "willing", "being");

// Words that join content words. A run of content words with none of these between is a noun cluster.
const FUNCTION_WORDS = words(
  "a", "an", "the", "this", "that", "these", "those", "each", "every", "all", "any", "both", "some", "no", "another",
  "my", "your", "his", "her", "its", "our", "their", "i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "has", "have", "had", "will", "would",
  "can", "could", "may", "might", "must", "shall", "should", "not", "and", "or", "but", "nor", "so", "if", "then",
  "when", "while", "before", "after", "until", "because", "since", "as", "than", "which", "who", "whom", "whose",
  "what", "where", "how", "why", "of", "in", "on", "at", "by", "for", "with", "from", "to", "into", "onto", "over",
  "under", "between", "through", "about", "against", "without", "within", "per", "up", "down", "out", "off", "also", "only",
  "very", "too", "again", "there", "here", "just", "even", "still", "yet", "more", "most", "less", "much", "many",
);

// Verbs that take an object. A sentence that starts with one and goes straight to a noun has no article.
const ARTICLE_VERBS = words("remove", "install", "replace", "disconnect", "connect", "open", "close", "clean", "tighten", "loosen", "lock", "unlock", "drain", "fill");
const NOT_OBJECT_START = words(
  "the", "a", "an", "this", "that", "these", "those", "each", "every", "all", "any", "both", "your", "its", "their", "our", "my", "his", "her",
  "it", "them", "him", "you", "us", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "and", "or", "if", "when",
  "whether", "before", "after", "until", "while", "to", "for", "with", "from", "in", "on", "at", "by", "of", "as", "up", "down", "out", "off",
  "again", "not", "then", "only", "first", "last", "new", "old", "same", "other", "another", "no", "some", "more", "most", "source",
);

// Words that start a statement where a command or a condition belongs.
const STATEMENT_START = words("the", "a", "an", "this", "that", "these", "those", "it", "you", "we", "there", "they", "he", "she", "i");

// A British spelling from a short list that this project wrote. Matches "the colour grey" → "colour" and "grey"; rejects "the color gray".
// https://regexr.com/?expression=%2F%5Cb%28colours%3F%7Cbehaviours%3F%7Cfavour%28%3F%3As%7Cite%7Cites%7Ced%29%3F%7Ccentres%3F%7Cmetres%3F%7Clitres%3F%7Cfibres%3F%7Canalyse%7Canalysed%7Canalysing%7Corganis%28%3F%3Ae%7Ces%7Ced%7Cing%7Cation%7Cations%29%7Crecognis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Cinitialis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Csynchronis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Coptimis%28%3F%3Ae%7Ces%7Ced%7Cing%7Cation%29%7Cminimis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Cmaximis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Cnormalis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Cserialis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Ccustomis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Cauthoris%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Cvisualis%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Csummaris%28%3F%3Ae%7Ces%7Ced%7Cing%29%7Ccatalogues%3F%7Cgreys%3F%7Clicences%3F%7Ctravell%28%3F%3Aing%7Ced%7Cer%29%7Ccancell%28%3F%3Aed%7Cing%29%7Cmodell%28%3F%3Aing%7Ced%29%7Clabell%28%3F%3Aed%7Cing%29%7Cdefences%3F%7Cneighbours%3F%7Chonours%3F%7Cprogrammes%3F%7Cartefacts%3F%7Cjudgements%3F%7Cageing%29%5Cb%2Fgim&text=the%20colour%20grey%0Athe%20color%20gray
const BRITISH = new RegExp(
  String.raw`\b(colours?|behaviours?|favour(?:s|ite|ites|ed)?|centres?|metres?|litres?|fibres?|analyse|analysed|analysing|` +
    String.raw`organis(?:e|es|ed|ing|ation|ations)|recognis(?:e|es|ed|ing)|initialis(?:e|es|ed|ing)|synchronis(?:e|es|ed|ing)|` +
    String.raw`optimis(?:e|es|ed|ing|ation)|minimis(?:e|es|ed|ing)|maximis(?:e|es|ed|ing)|normalis(?:e|es|ed|ing)|` +
    String.raw`serialis(?:e|es|ed|ing)|customis(?:e|es|ed|ing)|authoris(?:e|es|ed|ing)|visualis(?:e|es|ed|ing)|` +
    String.raw`summaris(?:e|es|ed|ing)|catalogues?|greys?|licences?|travell(?:ing|ed|er)|cancell(?:ed|ing)|modell(?:ing|ed)|` +
    String.raw`labell(?:ed|ing)|defences?|neighbours?|honours?|programmes?|artefacts?|judgements?|ageing)\b`,
  "gi",
);

const cpLength = (text: string): number => chars(text).length;
// 1-based column, in code points, of a UTF-16 index in a line.
const colOf = (line: string, index: number): number => cpLength(line.slice(0, index)) + 1;
const isHeading = (text: string): boolean => text.startsWith("#");
const isTableLine = (text: string): boolean => text.startsWith("|");
const edgeTrim = (text: string): string => text.replace(EDGE_PUNCTUATION, "");
const countSentences = (text: string): number => [...text.matchAll(SENTENCE_END)].length;
const withoutAbbreviations = (text: string): string => text.replace(ABBREVIATION, "x");

const ALL_SPECS: Readonly<Record<string, string>> = { ...SPEC_OF, ...EXTRA_SPEC };

// The specification of a rule, whichever table it is in.
export const specOf = (rule: string): string => ALL_SPECS[rule] ?? "";

// Relabels the upstream findings for the profile and adds the checks of this project.
export function extend(findings: readonly Violation[], text: string, filename: string, profile: Profile): Violation[] {
  const relabeled = findings.flatMap((f): Violation[] => {
    const spec = specOf(f.rule) || undefined;
    if (spec?.startsWith(EXTRA_PREFIX) && profile !== Profile.Agent) return [];
    if (f.rule === "long-sentence" && profile === Profile.Procedure) return []; // procedure-length replaces it
    return [{ ...f, message: f.rule === "passive-voice" ? PASSIVE_MESSAGE : f.message, ...(spec ? { spec } : {}) }];
  });
  return [...relabeled, ...extraFindings(text, filename, profile)].sort((a, b) => a.line - b.line || a.col - b.col);
}

// The lines the extra checks read: code fences, inline code, URLs and HTML comments are blanked, so columns stay right.
function proseLines(text: string): string[] {
  const lines = splitLines(blankNonProse(text));
  const kinds = lineKinds(lines);
  return lines.map((line, i) => (kinds[i] === LineKind.Text ? line.replace(INLINE_CODE, (span) => " ".repeat(cpLength(span))) : ""));
}

const extra = (rule: keyof typeof EXTRA_SPEC, level: Level, file: string, line: number, col: number, match: string, message: string): Violation => ({ file, line, col, rule, level, match, message, spec: EXTRA_SPEC[rule] });

function extraFindings(text: string, filename: string, profile: Profile): Violation[] {
  const lines = proseLines(text);
  const perLine = lines.flatMap((raw, i): Violation[] => {
    const no = i + 1;
    const trimmed = strip(raw);
    if (!trimmed || isTableLine(trimmed)) return [];
    const at = (rule: keyof typeof EXTRA_SPEC, level: Level, index: number, match: string, message: string): Violation => extra(rule, level, filename, no, colOf(raw, index), match, message);
    const contractions = [...raw.matchAll(CONTRACTION)].map((m) => at("contraction", Level.Hard, m.index ?? 0, m[0], "Contraction. Write the full words (do not, it is, cannot)."));
    const ingForms = [...raw.matchAll(ING_FORM)]
      .filter((m) => !NOT_ING_VERB.has((m[1] ?? "").toLowerCase()))
      .map((m) => at("ing-form", Level.Advisory, m.index ?? 0, m[0], "-ing form of a verb. Use the simple present or the simple past tense."));
    const british = [...raw.matchAll(BRITISH)].map((m) => at("british-spelling", Level.Advisory, m.index ?? 0, m[0], "British spelling. Use the American spelling (color, center, analyze)."));
    if (isHeading(trimmed)) return [...contractions, ...ingForms, ...british];
    const clusters = nounRuns(raw).map((r) =>
      at("noun-cluster", Level.Advisory, r.start, r.text, `${r.n} content words in a row (cap ${MAX_NOUN_RUN}). Join them with of, for or to, or split the phrase.`),
    );
    const procedure =
      profile === Profile.Procedure
        ? splitSentences(raw)
            .map((sent) => ({ sent, n: wordCount(sent) }))
            .filter(({ n }) => n > MAX_WORDS_PROCEDURE)
            .map(({ sent, n }) => at("procedure-length", Level.Hard, raw.indexOf(strip(sent)), `${n} words`, `Sentence has ${n} words (cap ${MAX_WORDS_PROCEDURE} in a procedure). Split it.`))
        : [];
    return [...contractions, ...ingForms, ...british, ...clusters, ...articleFindings(raw, no, filename), ...procedure];
  });
  return [...perLine, ...paragraphFindings(lines, filename), ...warningFindings(lines, filename)];
}

interface NounRun {
  readonly start: number;
  readonly n: number;
  readonly text: string;
}

interface RunScan {
  readonly current: readonly string[];
  readonly startIndex: number;
  readonly runs: readonly NounRun[];
  readonly sentenceStart: boolean; // the first word of a sentence may be capitalized for that reason only
}

const SENTENCE_ENDS: ReadonlySet<string> = new Set([".", "!", "?", ":"]);

// Runs of more than MAX_NOUN_RUN content words with no function word, punctuation or proper name between them.
// This is a heuristic: it has no part-of-speech tagger.
function nounRuns(line: string): NounRun[] {
  const close = (state: RunScan): RunScan => ({
    ...state,
    current: [],
    runs: state.current.length > MAX_NOUN_RUN ? [...state.runs, { start: state.startIndex, n: state.current.length, text: state.current.join(" ") }] : state.runs,
  });
  const end = [...line.matchAll(WORD_TOKEN)].reduce<RunScan>(
    (state, m) => {
      const token = m[0];
      if (!LETTER_START.test(token)) return { ...close(state), sentenceStart: SENTENCE_ENDS.has(token) };
      const isName = CAPITAL_START.test(token) && !state.sentenceStart;
      const skipped: RunScan = { ...state, sentenceStart: false };
      if (FUNCTION_WORDS.has(token.toLowerCase()) || isName || HAS_DIGIT.test(token)) return close(skipped);
      return { ...skipped, startIndex: state.current.length ? state.startIndex : (m.index ?? 0), current: [...state.current, token] };
    },
    { current: [], startIndex: 0, runs: [], sentenceStart: true },
  );
  return [...close(end).runs];
}

function articleFindings(line: string, no: number, filename: string): Violation[] {
  const scan = splitSentences(line).reduce<{ readonly offset: number; readonly found: readonly Violation[] }>(
    (state, sent) => {
      const s = strip(sent);
      const at = line.indexOf(s, state.offset);
      if (at === NOT_FOUND || !s) return state;
      const next = { offset: at + s.length, found: state.found };
      const fields = s.replace(LIST_MARKER, "").split(WHITESPACE).filter(Boolean);
      const [first, second] = fields;
      if (!first || !second) return next;
      const verb = edgeTrim(first).toLowerCase();
      const object = second.replace(EDGE_MARKS, "").toLowerCase();
      const needsArticle = ARTICLE_VERBS.has(verb) && !NOT_OBJECT_START.has(object) && !object.endsWith("ly") && !!object && !HAS_DIGIT.test(object) && !CAPITAL_START.test(second);
      if (!needsArticle) return next;
      const col = colOf(line, line.indexOf(first, at));
      return { ...next, found: [...state.found, extra("dropped-article", Level.Advisory, filename, no, col, `${first} ${second}`, "No article before the noun. Add the, a or an (remove the panel, not remove panel).")] };
    },
    { offset: 0, found: [] },
  );
  return [...scan.found];
}

interface ParagraphScan {
  readonly buffer: readonly string[];
  readonly startLine: number;
  readonly found: readonly Violation[];
}

// A paragraph is a run of plain lines: a blank line, a heading, a table row or a list item ends it.
function paragraphFindings(lines: readonly string[], filename: string): Violation[] {
  const flush = (state: ParagraphScan): ParagraphScan => {
    if (!state.buffer.length) return state;
    const n = countSentences(strip(withoutAbbreviations(state.buffer.join(" "))));
    const found = n > MAX_SENTENCES_IN_PARAGRAPH ? [...state.found, extra("paragraph-length", Level.Hard, filename, state.startLine, 1, `${n} sentences`, `Paragraph has ${n} sentences (cap ${MAX_SENTENCES_IN_PARAGRAPH}). Split it.`)] : state.found;
    return { ...state, buffer: [], found };
  };
  const end = lines.reduce<ParagraphScan>(
    (state, line, i) => {
      const t = strip(line);
      if (!t || isHeading(t) || isTableLine(t) || LIST_MARKER.test(line) || t.startsWith("<") || t.startsWith(">")) return flush(state);
      return { ...state, startLine: state.buffer.length ? state.startLine : i + 1, buffer: [...state.buffer, t] };
    },
    { buffer: [], startLine: 0, found: [] },
  );
  return [...flush(end).found];
}

// A WARNING or CAUTION block starts with a command or a condition, and states the risk in a sentence after that.
function warningFindings(lines: readonly string[], filename: string): Violation[] {
  return lines.flatMap((line, i): Violation[] => {
    const m = WARNING.exec(line);
    if (!m) return [];
    const label = m[1] ?? "";
    const endsBlock = (l: string, j: number): boolean => j > i && (!strip(l) || WARNING.test(l) || LIST_MARKER.test(l) || isHeading(strip(l)));
    const stop = lines.findIndex(endsBlock);
    const block = lines.slice(i + 1, stop === NOT_FOUND ? lines.length : stop).map((l) => strip(strip(l).replace(QUOTE_MARK, "")));
    const text = [strip(m[2] ?? ""), ...block].join(" ").trim();
    const fields = text.split(WHITESPACE).filter(Boolean);
    if (!fields.length) return [];
    const col = colOf(line, line.indexOf(label));
    const startsWithStatement = STATEMENT_START.has(edgeTrim(fields[0] ?? "").toLowerCase());
    const start = startsWithStatement ? [extra("warning-start", Level.Advisory, filename, i + 1, col, `${label} ${fields.slice(0, PREVIEW_WORDS).join(" ")}`, `${label} starts with a statement. Start with a command or a condition (Do not touch the rotor. If the rotor turns, ...).`)] : [];
    const risk = countSentences(withoutAbbreviations(text)) <= 1 ? [extra("warning-risk", Level.Advisory, filename, i + 1, col, label, `${label} has one sentence. Add a second sentence that states the risk, so the reader knows what the command prevents.`)] : [];
    return [...start, ...risk];
  });
}
