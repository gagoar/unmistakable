// Python string semantics that the original ste-lint.py relies on and that JavaScript does not have.
// Text is handled as arrays of code points, so a column counts characters, as in Python.

// Leading white space, as Python counts it. Matches "  ab" → "  "; rejects "ab".
// https://regex101.com/?flavor=javascript&regex=%5E%5B%5Ct-%5Cr%5Cx1c-%5Cx1f%20%5Cx85%5Cxa0%5Cu1680%5Cu2000-%5Cu200a%5Cu2028%5Cu2029%5Cu202f%5Cu205f%5Cu3000%5D%2B&flags=m&testString=%20%20ab%0Aab
const LEADING_SPACE = /^[\t-\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
// Trailing white space, as Python counts it. Matches "ab  " → "  "; rejects "ab".
// https://regex101.com/?flavor=javascript&regex=%5B%5Ct-%5Cr%5Cx1c-%5Cx1f%20%5Cx85%5Cxa0%5Cu1680%5Cu2000-%5Cu200a%5Cu2028%5Cu2029%5Cu202f%5Cu205f%5Cu3000%5D%2B%24&flags=m&testString=ab%20%20%0Aab
const TRAILING_SPACE = /[\t-\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/;
// A run of white space, as Python counts it. Matches the gap in "a  b" → "  "; rejects "ab".
// https://regex101.com/?flavor=javascript&regex=%5B%5Ct-%5Cr%5Cx1c-%5Cx1f%20%5Cx85%5Cxa0%5Cu1680%5Cu2000-%5Cu200a%5Cu2028%5Cu2029%5Cu202f%5Cu205f%5Cu3000%5D%2B&flags=m&testString=a%20%20b%0Aab
const SPACE_RUN = /[\t-\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
// One white-space character, as Python counts it. Matches " " and "\u3000"; rejects "a".
// https://regex101.com/?flavor=javascript&regex=%5E%5B%5Ct-%5Cr%5Cx1c-%5Cx1f%20%5Cx85%5Cxa0%5Cu1680%5Cu2000-%5Cu200a%5Cu2028%5Cu2029%5Cu202f%5Cu205f%5Cu3000%5D%24&flags=m&testString=%20%0A%E3%80%80%0Aa
const SPACE_CHAR = /^[\t-\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/;
// One Unicode word character, like Python's \w. Matches "é", "7" and "_"; rejects "-" and "😀".
// https://regex101.com/?flavor=javascript&regex=%5E%5B%5Cp%7BL%7D%5Cp%7BN%7D_%5D%24&flags=mu&testString=%C3%A9%0A7%0A_%0A-%0A%F0%9F%98%80
const WORD_CHAR = /^[\p{L}\p{N}_]$/u;
// A line break by the rules of Python's str.splitlines. Matches the break in "a⏎b" (a newline between a and b); rejects "ab".
// https://regex101.com/?flavor=javascript&regex=%5Cr%5Cn%7C%5B%5Cn%5Cv%5Cf%5Cx1c%5Cx1d%5Cx1e%5Cx85%5Cu2028%5Cu2029%5Cr%5D&flags=m&testString=a%0Ab%0Aab
const LINE_BREAK = /\r\n|[\n\v\f\x1c\x1d\x1e\x85\u2028\u2029\r]/;
// A character that Python's ensure_ascii writes as an escape. Replaced as "é" → "\u00e9"; "a" is unchanged.
// https://regex101.com/?flavor=javascript&regex=%5B%5Cu007f-%5Cuffff%5D&flags=gm&testString=%C3%A9%0Aa
const NON_ASCII = /[\u007f-\uffff]/g;

const ASCII_LIMIT = 0x80;
const HEX_RADIX = 16;
const ESCAPE_WIDTH = 4;
const TIE_FACTOR = 4;
const EVEN = 2;
const TENTH = 10;
const DECIMALS = 1;
const OTHER = "·"; // any non-ASCII character that is not a letter, a number or a space
const CLOSING_QUOTE = "’"; // the patterns for modal verbs hold it: n’t

export const chars = (text: string): string[] => Array.from(text);
export const isSpace = (ch: string): boolean => SPACE_CHAR.test(ch);
export const isWord = (ch: string): boolean => WORD_CHAR.test(ch);
export const strip = (text: string): string => text.replace(LEADING_SPACE, "").replace(TRAILING_SPACE, "");
export const lstrip = (text: string): string => text.replace(LEADING_SPACE, "");

// len(s.split())
export const wordCount = (text: string): number => text.split(SPACE_RUN).filter(Boolean).length;

// str.splitlines() without keepends: a final break does not start another line.
export function splitLines(text: string): string[] {
  const parts = text.split(LINE_BREAK);
  return parts.at(-1) === "" ? parts.slice(0, -1) : parts;
}

type Mapping = readonly [applies: (ch: string) => boolean, map: (ch: string) => string];

// Python's IGNORECASE folds these four to ASCII letters.
const FOLDS = { "ſ": "s", "K": "k", "ı": "i", "İ": "i" } as const satisfies Readonly<Record<string, string>>;
const KEEP: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r", "\f"]);
const same = (ch: string): string => ch;
const codePoint = (ch: string): number => ch.codePointAt(0) ?? 0;

// The first mapping that applies wins; the order is the contract.
const MAPPINGS: readonly Mapping[] = [
  [(ch) => ch in FOLDS, (ch) => FOLDS[ch as keyof typeof FOLDS] ?? ch], // `in` proved the key, so the cast only narrows the index
  [(ch) => KEEP.has(ch), same],
  [isSpace, () => "\t"],
  [(ch) => codePoint(ch) < ASCII_LIMIT, same],
  [isWord, () => "0"],
  [(ch) => ch === CLOSING_QUOTE, same],
];

// Maps code points to a string with one UTF-16 unit per code point, so that JavaScript's ASCII \w, \b and \s
// treat it as Python treats the original. An index into the result is an index in code points.
export function normalize(text: readonly string[]): string {
  return text.map((ch) => (MAPPINGS.find(([applies]) => applies(ch))?.[1] ?? (() => OTHER))(ch)).join("");
}

// round(x, 1) as Python gives it: an exact tie goes to the even tenth.
export function pyRound1(x: number): number {
  const isTie = (x * TIE_FACTOR) % EVEN === 1;
  if (!isTie) return Number(x.toFixed(DECIMALS));
  const tenths = Math.floor(x * TENTH);
  return (tenths % EVEN ? tenths + 1 : tenths) / TENTH;
}

// repr() of a float that round() has already cut to one decimal.
export const pyFloat = (value: number): string => (Number.isInteger(value) ? value.toFixed(DECIMALS) : String(value));

// json.dumps(text, ensure_ascii=True)
export const jsonString = (text: string): string =>
  JSON.stringify(text).replace(NON_ASCII, (unit) => `\\u${unit.charCodeAt(0).toString(HEX_RADIX).padStart(ESCAPE_WIDTH, "0")}`);
