package stelint

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Profile picks the rule set. The zero value is ProfileUpstream: exactly the checks of
// upstream's ste-lint.py, byte for byte. The other profiles relabel those checks with the
// number of the ASD-STE100 rule they follow, and add checks of this project.
//
// The rule numbers are those of ASD-STE100 Issue 9 (2025). They name a rule. They do not
// quote it: the standard is copyright ASD, and none of its text is shipped here. Check a
// number against your own copy of the standard.
type Profile string

const (
	// ProfileUpstream is upstream's linter, unchanged. No spec labels.
	ProfileUpstream Profile = "upstream"
	// ProfileAgent is for text that an AI agent reads. It holds every check. The default.
	ProfileAgent Profile = "agent"
	// ProfileDescriptive keeps the checks that follow a numbered STE rule, with the 25-word limit.
	ProfileDescriptive Profile = "descriptive"
	// ProfileProcedure is ProfileDescriptive with the 20-word limit of procedural writing.
	ProfileProcedure Profile = "procedure"
)

// Profiles lists the names --profile accepts.
var Profiles = []Profile{ProfileAgent, ProfileDescriptive, ProfileProcedure, ProfileUpstream}

// ParseProfile reads a profile name. The empty string means ProfileAgent.
func ParseProfile(s string) (Profile, bool) {
	if s == "" {
		return ProfileAgent, true
	}
	for _, p := range Profiles {
		if string(p) == s {
			return p, true
		}
	}
	return "", false
}

func (p Profile) extended() bool { return p != "" && p != ProfileUpstream }

const (
	maxWordsProcedure  = 20
	maxSentencesInPara = 6
	maxNounRun         = 3
)

// specOf names the STE rule behind each upstream check. A check with the prefix X- is this
// project's own: it is not an STE rule, and only ProfileAgent runs it.
var specOf = map[string]string{
	"semicolon":            "STE-8.1",
	"phrasal-verb":         "STE-9.3",
	"nominalization":       "STE-3.7",
	"passive-voice":        "STE-3.6",
	"present-perfect":      "STE-3.1",
	"synonym-rotation":     "STE-1.11",
	"long-sentence":        "STE-6.3",
	"marketing-adjective":  "X-marketing-adjective",
	"dangling-conjunction": "X-dangling-conjunction",
}

// SpecOf returns the spec label of a rule id, or "" when the rule has none.
func SpecOf(rule string) string {
	if s, ok := specOf[rule]; ok {
		return s
	}
	return extraSpec[rule]
}

// extraSpec holds the checks that only the extended profiles run.
var extraSpec = map[string]string{
	"paragraph-length": "STE-6.6",
	"contraction":      "STE-4.2",
	"ing-form":         "STE-3.5",
	"noun-cluster":     "STE-2.1",
	"warning-start":    "STE-7.2",
	"warning-risk":     "STE-7.3",
	"dropped-article":  "STE-4.5",
	"british-spelling": "STE-1.14",
	"procedure-length": "STE-5.1",
}

// ExtraRules lists the ids of the checks that only the extended profiles run, sorted.
func ExtraRules() []string {
	out := make([]string, 0, len(extraSpec))
	for id := range extraSpec {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

const passiveMessage36 = "Possible passive voice. Name the actor and use an active verb. The passive is for an actor that is unknown."

// extend relabels the upstream findings for the profile and adds this project's checks.
func extend(findings []Violation, text, filename string, p Profile) []Violation {
	var out []Violation
	for _, f := range findings {
		spec := specOf[f.Rule]
		if strings.HasPrefix(spec, "X-") && p != ProfileAgent {
			continue
		}
		if f.Rule == "long-sentence" && p == ProfileProcedure {
			continue // replaced by procedure-length
		}
		f.Spec = spec
		if f.Rule == "passive-voice" {
			f.Message = passiveMessage36
		}
		out = append(out, f)
	}
	out = append(out, extraFindings(text, filename, p)...)
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Line != out[b].Line {
			return out[a].Line < out[b].Line
		}
		return out[a].Col < out[b].Col
	})
	return out
}

var (
	contractionRe = regexp.MustCompile(`(?i)\b[a-z]+(?:n['’]t|['’](?:re|ve|ll|d|m))\b`)
	ingFormRe     = regexp.MustCompile(`(?i)\b(?:is|are|was|were|be|been)\s+([a-z]+ing)\b`)
	// Words that end in -ing but are not a verb form, or are adjectives that read as plain English.
	notIngVerb = setOf("bring", "string", "thing", "king", "ring", "spring", "sing", "wing", "sting", "swing", "cling",
		"fling", "sling", "ceiling", "nothing", "something", "anything", "everything", "morning", "evening", "during",
		"missing", "following", "existing", "remaining", "matching", "corresponding", "interesting", "surprising",
		"amazing", "willing", "being")
	warningRe     = regexp.MustCompile(`^\s*(?:>\s*)?(?:\*\*)?(WARNING|CAUTION)(?:\*\*)?\s*[:.\-—]?\s*(.*)$`)
	wordRe        = regexp.MustCompile(`[A-Za-z][A-Za-z0-9'’-]*|[^\sA-Za-z]`)
	abbreviations = regexp.MustCompile(`(?i)\b(?:e\.g|i\.e|etc|vs|approx|cf)\.`)
	listMarkerRe  = regexp.MustCompile(`^\s*(?:[-*+]|[0-9]+[.)])\s+`)

	// Words that join content words. A run of content words with none of these between is a noun cluster.
	functionWords = setOf(
		"a", "an", "the", "this", "that", "these", "those", "each", "every", "all", "any", "both", "some", "no", "another",
		"my", "your", "his", "her", "its", "our", "their", "i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them",
		"is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "has", "have", "had", "will", "would",
		"can", "could", "may", "might", "must", "shall", "should", "not", "and", "or", "but", "nor", "so", "if", "then",
		"when", "while", "before", "after", "until", "because", "since", "as", "than", "that", "which", "who", "whom", "whose",
		"what", "where", "how", "why", "of", "in", "on", "at", "by", "for", "with", "from", "to", "into", "onto", "over",
		"under", "between", "through", "about", "against", "without", "within", "per", "up", "down", "out", "off", "also", "only",
		"very", "too", "again", "there", "here", "just", "even", "still", "yet", "more", "most", "less", "much", "many",
	)

	// Verbs that take an object. A sentence that starts with one and goes straight to a noun has no article.
	articleVerbs = setOf("remove", "install", "replace", "disconnect", "connect", "open", "close", "clean", "tighten",
		"loosen", "lock", "unlock", "drain", "fill")
	notObjectStart = setOf("the", "a", "an", "this", "that", "these", "those", "each", "every", "all", "any", "both", "your",
		"its", "their", "our", "my", "his", "her", "it", "them", "him", "you", "us", "one", "two", "three", "four", "five",
		"six", "seven", "eight", "nine", "ten", "and", "or", "if", "when", "whether", "before", "after", "until", "while", "to",
		"for", "with", "from", "in", "on", "at", "by", "of", "as", "up", "down", "out", "off", "again", "not", "then", "only",
		"first", "last", "new", "old", "same", "other", "another", "no", "some", "more", "most", "source")

	// Words that start a statement where a command or a condition belongs.
	statementStart = setOf("the", "a", "an", "this", "that", "these", "those", "it", "you", "we", "there", "they", "he", "she", "i")

	britishRe = regexp.MustCompile(`(?i)\b(colours?|behaviours?|favour(?:s|ite|ites|ed)?|centres?|metres?|litres?|fibres?|` +
		`analyse|analysed|analysing|organis(?:e|es|ed|ing|ation|ations)|recognis(?:e|es|ed|ing)|initialis(?:e|es|ed|ing)|` +
		`synchronis(?:e|es|ed|ing)|optimis(?:e|es|ed|ing|ation)|minimis(?:e|es|ed|ing)|maximis(?:e|es|ed|ing)|` +
		`normalis(?:e|es|ed|ing)|serialis(?:e|es|ed|ing)|customis(?:e|es|ed|ing)|authoris(?:e|es|ed|ing)|` +
		`visualis(?:e|es|ed|ing)|summaris(?:e|es|ed|ing)|catalogues?|greys?|licences?|travell(?:ing|ed|er)|` +
		`cancell(?:ed|ing)|modell(?:ing|ed)|labell(?:ed|ing)|defences?|neighbours?|honours?|programmes?|artefacts?|` +
		`judgements?|ageing)\b`)
)

func setOf(words ...string) map[string]bool {
	m := make(map[string]bool, len(words))
	for _, w := range words {
		m[w] = true
	}
	return m
}

// proseLines returns the lines the extra checks read: code fences, inline code spans, URLs and
// HTML comments are blanked with spaces, so columns stay right. A fenced line becomes "".
func proseLines(text string) []string {
	lines := splitLines(blankNonProse(text))
	inFence := false
	for i, l := range lines {
		if codeFence.MatchString(pyStrip(l)) {
			inFence = !inFence
			lines[i] = ""
			continue
		}
		if inFence {
			lines[i] = ""
			continue
		}
		lines[i] = inlineCode.ReplaceAllStringFunc(l, func(m string) string { return strings.Repeat(" ", len([]rune(m))) })
	}
	return lines
}

func isTableLine(t string) bool { return strings.HasPrefix(t, "|") }
func isHeading(t string) bool   { return strings.HasPrefix(t, "#") }

func extraFindings(text, filename string, p Profile) []Violation {
	lines := proseLines(text)
	var out []Violation
	add := func(rule, level string, line, col int, match, msg string) {
		out = append(out, Violation{File: filename, Line: line, Col: col, Rule: rule, Level: level, Match: match, Message: msg, Spec: extraSpec[rule]})
	}

	for i, raw := range lines {
		no := i + 1
		t := strings.TrimSpace(raw)
		if t == "" || isTableLine(t) {
			continue
		}
		col := func(byteIdx int) int { return len([]rune(raw[:byteIdx])) + 1 }

		for _, m := range contractionRe.FindAllStringIndex(raw, -1) {
			add("contraction", LevelHard, no, col(m[0]), raw[m[0]:m[1]],
				"Contraction. Write the full words (do not, it is, cannot).")
		}
		for _, m := range ingFormRe.FindAllStringSubmatchIndex(raw, -1) {
			if notIngVerb[strings.ToLower(raw[m[2]:m[3]])] {
				continue
			}
			add("ing-form", LevelAdvisory, no, col(m[0]), raw[m[0]:m[1]],
				"-ing form of a verb. Use the simple present or the simple past tense.")
		}
		for _, m := range britishRe.FindAllStringIndex(raw, -1) {
			add("british-spelling", LevelAdvisory, no, col(m[0]), raw[m[0]:m[1]],
				"British spelling. Use the American spelling (color, center, analyze).")
		}
		if isHeading(t) {
			continue
		}
		for _, run := range nounRuns(raw) {
			add("noun-cluster", LevelAdvisory, no, col(run.start), run.text,
				fmt.Sprintf("%d content words in a row (cap %d). Join them with of, for or to, or split the phrase.", run.n, maxNounRun))
		}
		out = append(out, articleFindings(raw, no, filename)...)

		if p == ProfileProcedure {
			for _, sent := range splitSentences([]rune(raw)) {
				if n := pyWordCount(sent); n > maxWordsProcedure {
					add("procedure-length", LevelHard, no, col(strings.Index(raw, strings.TrimSpace(sent))), strconv.Itoa(n)+" words",
						"Sentence has "+strconv.Itoa(n)+" words (cap "+strconv.Itoa(maxWordsProcedure)+" in a procedure). Split it.")
				}
			}
		}
	}
	out = append(out, paragraphFindings(lines, filename)...)
	out = append(out, warningFindings(lines, filename)...)
	return out
}

type run struct {
	start, n int
	text     string
}

// nounRuns finds runs of more than maxNounRun content words with no function word, punctuation or
// proper name between them. This is a heuristic: it has no part-of-speech tagger.
func nounRuns(line string) []run {
	var out []run
	var cur []string
	startIdx := 0
	flush := func() {
		if len(cur) > maxNounRun {
			out = append(out, run{start: startIdx, n: len(cur), text: strings.Join(cur, " ")})
		}
		cur = nil
	}
	first := true // the first word of a sentence may be capitalised for that reason only
	for _, m := range wordRe.FindAllStringIndex(line, -1) {
		tok := line[m[0]:m[1]]
		r := []rune(tok)[0]
		isWord := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if !isWord {
			flush()
			first = tok == "." || tok == "!" || tok == "?" || tok == ":"
			continue
		}
		lower := strings.ToLower(tok)
		name := r >= 'A' && r <= 'Z' && !first
		first = false
		if functionWords[lower] || name || strings.ContainsAny(tok, "0123456789") {
			flush()
			continue
		}
		if len(cur) == 0 {
			startIdx = m[0]
		}
		cur = append(cur, tok)
	}
	flush()
	return out
}

func articleFindings(line string, no int, filename string) []Violation {
	var out []Violation
	offset := 0
	for _, sent := range splitSentences([]rune(line)) {
		s := strings.TrimSpace(sent)
		idx := strings.Index(line[offset:], s)
		if idx < 0 || s == "" {
			continue
		}
		start := offset + idx
		offset = start + len(s)
		body := listMarkerRe.ReplaceAllString(s, "")
		words := strings.Fields(body)
		if len(words) < 2 {
			continue
		}
		verb := strings.ToLower(strings.Trim(words[0], ".,:;"))
		next := strings.ToLower(strings.Trim(words[1], ".,:;!?"))
		if !articleVerbs[verb] || notObjectStart[next] || strings.HasSuffix(next, "ly") || next == "" || strings.ContainsAny(next, "0123456789") {
			continue
		}
		// A proper name needs no article: Open GitHub.
		if r := []rune(words[1])[0]; r >= 'A' && r <= 'Z' {
			continue
		}
		pos := strings.Index(line[start:], words[0]) + start
		out = append(out, Violation{File: filename, Line: no, Col: len([]rune(line[:pos])) + 1, Rule: "dropped-article", Level: LevelAdvisory,
			Match: words[0] + " " + words[1], Message: "No article before the noun. Add the, a or an (remove the panel, not remove panel).", Spec: extraSpec["dropped-article"]})
	}
	return out
}

// paragraphFindings reports a paragraph of more than maxSentencesInPara sentences. A paragraph is a
// run of plain lines: a blank line, a heading, a table row or a list item ends it.
func paragraphFindings(lines []string, filename string) []Violation {
	var out []Violation
	var buf []string
	startLine := 0
	flush := func() {
		if len(buf) == 0 {
			return
		}
		joined := abbreviations.ReplaceAllString(strings.Join(buf, " "), "x")
		n := len(sentenceEnd.FindAllStringIndex(strings.TrimSpace(joined), -1))
		if n > maxSentencesInPara {
			out = append(out, Violation{File: filename, Line: startLine, Col: 1, Rule: "paragraph-length", Level: LevelHard,
				Match: strconv.Itoa(n) + " sentences", Spec: extraSpec["paragraph-length"],
				Message: "Paragraph has " + strconv.Itoa(n) + " sentences (cap " + strconv.Itoa(maxSentencesInPara) + "). Split it."})
		}
		buf = nil
	}
	for i, l := range lines {
		t := strings.TrimSpace(l)
		if t == "" || isHeading(t) || isTableLine(t) || listMarkerRe.MatchString(l) || strings.HasPrefix(t, "<") || strings.HasPrefix(t, ">") {
			flush()
			continue
		}
		if len(buf) == 0 {
			startLine = i + 1
		}
		buf = append(buf, t)
	}
	flush()
	return out
}

var sentenceEnd = regexp.MustCompile(`[.!?]+(?:\s+|$)`)

// warningFindings checks a WARNING or CAUTION block: it starts with a command or a condition, and it
// states the risk in a sentence after that.
func warningFindings(lines []string, filename string) []Violation {
	var out []Violation
	for i := 0; i < len(lines); i++ {
		m := warningRe.FindStringSubmatchIndex(lines[i])
		if m == nil {
			continue
		}
		text := strings.TrimSpace(lines[i][m[4]:m[5]])
		for j := i + 1; j < len(lines) && strings.TrimSpace(lines[j]) != "" && warningRe.FindStringIndex(lines[j]) == nil &&
			!listMarkerRe.MatchString(lines[j]) && !isHeading(strings.TrimSpace(lines[j])); j++ {
			text += " " + strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[j]), ">"))
		}
		label := lines[i][m[2]:m[3]]
		col := len([]rune(lines[i][:m[2]])) + 1
		fields := strings.Fields(text)
		if len(fields) > 0 && statementStart[strings.ToLower(strings.Trim(fields[0], ".,:;"))] {
			out = append(out, Violation{File: filename, Line: i + 1, Col: col, Rule: "warning-start", Level: LevelAdvisory,
				Match: label + " " + strings.Join(fields[:min(3, len(fields))], " "), Spec: extraSpec["warning-start"],
				Message: label + " starts with a statement. Start with a command or a condition (Do not touch the rotor. If the rotor turns, ...)."})
		}
		if n := len(sentenceEnd.FindAllStringIndex(abbreviations.ReplaceAllString(text, "x"), -1)); len(fields) > 0 && n < 2 {
			out = append(out, Violation{File: filename, Line: i + 1, Col: col, Rule: "warning-risk", Level: LevelAdvisory,
				Match: label, Spec: extraSpec["warning-risk"],
				Message: label + " has one sentence. Add a second sentence that states the risk, so the reader knows what the command prevents."})
		}
	}
	return out
}
