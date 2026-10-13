// Blanks what is not prose, with spaces, so line and column numbers stay put: HTML comments and URLs.
// Fenced code and inline code are skipped by the linter itself.
import { CODE_FENCE, INLINE_CODE } from "./core.ts";
import { chars, splitLines, strip } from "./pytext.ts";

// A URL that starts with http://, https://, ftp:// or www.. Matches "see https://a.test/x." → "https://a.test/x."; rejects "see a.test".
const URL = /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<>]+/gi;
// Punctuation at the end of a URL that is not part of it. Matches the "." in "https://a.test/x."; rejects "https://a.test/x".
const URL_TRAIL = /[.,;:!?)\]'\"*_]+$/;

const COMMENT_OPEN = chars("<!--");
const COMMENT_CLOSE = chars("-->");
const NOT_FOUND = -1;

const indexOfRun = (text: readonly string[], run: readonly string[], from: number): number => {
  const start = text.findIndex((_, i) => i >= from && run.every((c, j) => text[i + j] === c));
  return start;
};

// Whether the character at a code point index sits inside a backtick span of the line.
function insideCodeSpan(line: string, cpIndex: number): boolean {
  const unit = chars(line).slice(0, cpIndex).join("").length;
  return [...line.matchAll(INLINE_CODE)].some((m) => unit >= (m.index ?? 0) && unit < (m.index ?? 0) + m[0].length);
}

const blank = (text: readonly string[], from: number, to: number): string[] => text.map((c, i) => (i >= from && i < to ? " " : c));

interface Scan {
  readonly text: readonly string[];
  readonly inComment: boolean;
}

// Blanks the comments of one line, from `pos`, and says whether a comment is still open at the end of it.
function blankComments(text: readonly string[], pos: number, inComment: boolean): Scan {
  if (pos >= text.length) return { text, inComment };
  if (inComment) {
    const end = indexOfRun(text, COMMENT_CLOSE, pos);
    if (end === NOT_FOUND) return { text: blank(text, pos, text.length), inComment: true };
    return blankComments(blank(text, pos, end + COMMENT_CLOSE.length), end + COMMENT_CLOSE.length, false);
  }
  const openings = (from: number): number => {
    const at = indexOfRun(text, COMMENT_OPEN, from);
    return at !== NOT_FOUND && insideCodeSpan(text.join(""), at) ? openings(at + 1) : at;
  };
  const start = openings(pos);
  if (start === NOT_FOUND) return { text, inComment: false };
  return blankComments(blank(text, start, start + COMMENT_OPEN.length), start + COMMENT_OPEN.length, true);
}

function blankUrls(line: string): string {
  const spans = [...line.matchAll(INLINE_CODE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const);
  return line.replace(URL, (url, offset: number) => {
    if (spans.some(([from, to]) => offset >= from && offset < to)) return url;
    const trail = URL_TRAIL.exec(url);
    const kept = trail ? url.slice(0, trail.index) : url;
    return " ".repeat(chars(kept).length) + url.slice(kept.length);
  });
}

interface ProseScan {
  readonly lines: readonly string[];
  readonly inFence: boolean;
  readonly inComment: boolean;
}

export function blankNonProse(text: string): string {
  const scan = splitLines(text).reduce<ProseScan>(
    (state, line) => {
      const isFence = !state.inComment && CODE_FENCE.test(strip(line));
      if (isFence) return { ...state, lines: [...state.lines, line], inFence: !state.inFence };
      if (!state.inComment && state.inFence) return { ...state, lines: [...state.lines, line] };
      const scanned = blankComments(chars(line), 0, state.inComment);
      const out = scanned.text.join("");
      return { lines: [...state.lines, state.inFence ? out : blankUrls(out)], inFence: state.inFence, inComment: scanned.inComment };
    },
    { lines: [], inFence: false, inComment: false },
  );
  return scan.lines.join("\n");
}
