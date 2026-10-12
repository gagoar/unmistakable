package stelint

import (
	"os"
	"strings"
	"testing"
)

func profileFor(rule string) Profile {
	if rule == "procedure-length" {
		return ProfileProcedure
	}
	return ProfileAgent
}

func countRule(r Report, rule string) int {
	n := 0
	for _, v := range r.Violations {
		if v.Rule == rule {
			n++
		}
	}
	return n
}

// Every extra rule has a fixture that fires it and a fixture that does not. A rule without both
// fails the build, so a new rule cannot ship untested.
func TestEveryExtraRuleHasFixtures(t *testing.T) {
	for _, id := range ExtraRules() {
		t.Run(id, func(t *testing.T) {
			read := func(kind string) string {
				b, err := os.ReadFile("testdata/rules/" + id + "." + kind + ".md")
				if err != nil {
					t.Fatalf("rule %s needs testdata/rules/%s.%s.md: %v", id, id, kind, err)
				}
				return string(b)
			}
			opts := Options{Profile: profileFor(id)}
			fail := LintNamed(read("fail"), id+".fail.md", opts)
			if countRule(fail, id) == 0 {
				t.Errorf("the fail fixture does not fire %s: %+v", id, fail.Violations)
			}
			for _, v := range fail.Violations {
				if v.Rule == id && v.Spec != extraSpec[id] {
					t.Errorf("%s has spec %q, want %q", id, v.Spec, extraSpec[id])
				}
			}
			pass := LintNamed(read("pass"), id+".pass.md", opts)
			if n := countRule(pass, id); n != 0 {
				t.Errorf("the pass fixture fires %s %d times: %+v", id, n, pass.Violations)
			}
		})
	}
}

func TestUpstreamProfileAddsNothing(t *testing.T) {
	for _, id := range ExtraRules() {
		b, _ := os.ReadFile("testdata/rules/" + id + ".fail.md")
		for _, opts := range []Options{{}, {Profile: ProfileUpstream}} {
			for _, v := range Lint(string(b), opts).Violations {
				if v.Spec != "" || extraSpec[v.Rule] != "" {
					t.Errorf("%s: the upstream profile must not run %s or label a spec: %+v", id, v.Rule, v)
				}
			}
		}
	}
	// No spec key in the JSON, so the output stays equal to upstream's.
	j, _ := Lint("a; b", Options{}).JSON()
	if strings.Contains(string(j), `"spec"`) {
		t.Errorf("the upstream JSON must not hold a spec key: %s", j)
	}
}

func TestSpecLabelsAndProfiles(t *testing.T) {
	text := "The panel is removed; the job is seamless. We have received the report.\n"
	ids := func(r Report) map[string]string {
		m := map[string]string{}
		for _, v := range r.Violations {
			m[v.Rule] = v.Spec
		}
		return m
	}
	agent := ids(Lint(text, Options{Profile: ProfileAgent}))
	want := map[string]string{"semicolon": "STE-8.1", "passive-voice": "STE-3.6", "present-perfect": "STE-3.1", "marketing-adjective": "X-marketing-adjective"}
	for rule, spec := range want {
		if got, ok := agent[rule]; !ok || got != spec {
			t.Errorf("agent: %s = %q (present %v), want %q", rule, got, ok, spec)
		}
	}
	// The descriptive and procedure profiles keep only the checks that follow an STE rule.
	for _, p := range []Profile{ProfileDescriptive, ProfileProcedure} {
		got := ids(Lint(text, Options{Profile: p}))
		if _, ok := got["marketing-adjective"]; ok {
			t.Errorf("%s must not run X- checks", p)
		}
		if got["semicolon"] != "STE-8.1" {
			t.Errorf("%s must keep semicolon", p)
		}
	}
	// A rule that the standard states does not allow the passive for an actor that is merely irrelevant.
	r := Lint("The panel is removed.", Options{Profile: ProfileAgent})
	if len(r.Violations) == 0 || strings.Contains(r.Violations[0].Message, "irrelevant") {
		t.Errorf("the passive message must not call an irrelevant actor acceptable: %+v", r.Violations)
	}
}

func TestProcedureProfileUsesTheTwentyWordLimit(t *testing.T) {
	sent := strings.TrimSpace(strings.Repeat("word ", 22)) + "."
	proc := Lint(sent, Options{Profile: ProfileProcedure})
	if countRule(proc, "procedure-length") != 1 || countRule(proc, "long-sentence") != 0 {
		t.Errorf("procedure: 22 words must fire procedure-length only: %+v", proc.Violations)
	}
	desc := Lint(sent, Options{Profile: ProfileDescriptive})
	if countRule(desc, "long-sentence") != 0 || countRule(desc, "procedure-length") != 0 {
		t.Errorf("descriptive: 22 words is within the 25-word limit: %+v", desc.Violations)
	}
	long := strings.TrimSpace(strings.Repeat("word ", 26)) + "."
	if countRule(Lint(long, Options{Profile: ProfileDescriptive}), "long-sentence") != 1 {
		t.Error("descriptive: 26 words must fire long-sentence")
	}
}

func TestCodeAndHeadingsAreNotProse(t *testing.T) {
	text := "# Hydraulic pump pressure switch housing\n\n```\nx = isn't; colour\n```\n\nUse `colour` and https://example.com/colour here.\n"
	for _, v := range Lint(text, Options{Profile: ProfileAgent}).Violations {
		t.Errorf("code, headings and URLs must be skipped: %+v", v)
	}
}

func TestModalHedgesStayUnflagged(t *testing.T) {
	r := Lint("The request may have failed. It could be a timeout. The disk might have filled.\n", Options{Profile: ProfileAgent})
	if len(r.Violations) != 0 {
		t.Errorf("hedges are content, not style: %+v", r.Violations)
	}
}
