package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func do(t *testing.T, stdin string, args ...string) (code int, out, errs string) {
	t.Helper()
	var o, e bytes.Buffer
	code = run(args, strings.NewReader(stdin), &o, &e)
	return code, o.String(), e.String()
}

// --json must equal upstream's own output, byte for byte, for every test input. Upstream
// labels each violation with the path it was given, so the run uses the same relative path.
func TestJSONEqualsUpstreamGolden(t *testing.T) {
	t.Chdir("../../internal/stelint")
	files, _ := filepath.Glob("testdata/golden/*.json")
	if len(files) == 0 {
		t.Fatal("no golden files")
	}
	for _, g := range files {
		in := "testdata/" + strings.TrimSuffix(filepath.Base(g), ".json")
		want, err := os.ReadFile(g)
		if err != nil {
			t.Fatal(err)
		}
		_, out, _ := do(t, "", "--profile", "upstream", "--json", in)
		if strings.TrimRight(out, "\n") != strings.TrimRight(string(want), "\n") {
			t.Errorf("%s: --json differs from the upstream golden", in)
		}
	}
}

func TestExitCodes(t *testing.T) {
	cases := []struct {
		name   string
		in     string
		args   []string
		code   int
		stdout string
	}{
		{"clean text passes", "Close the valve.\n", nil, 0, "0 violations"},
		{"a hard violation fails", "Close the valve; open the door.\n", nil, 1, "semicolon"},
		{"a baseline tolerates it", "Close the valve; open the door.\n", []string{"--baseline", "1"}, 0, "1 hard, baseline 1"},
		{"--disable silences a rule", "Close the valve; open the door.\n", []string{"--disable", "semicolon"}, 0, "0 violations"},
		{"hedges are never flagged", "The request may have failed.\n", nil, 0, "0 violations"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, out, errs := do(t, c.in, c.args...)
			if code != c.code || !strings.Contains(out, c.stdout) {
				t.Errorf("code=%d (want %d) out=%q err=%q, want output containing %q", code, c.code, out, errs, c.stdout)
			}
		})
	}
}

func TestProfiles(t *testing.T) {
	text := "The task isn't done; the colour is grey.\n"
	code, out, _ := do(t, text)
	if code != 1 || !strings.Contains(out, "contraction (STE-4.2)") || !strings.Contains(out, "semicolon (STE-8.1)") {
		t.Errorf("the default profile is agent, and labels each rule with its spec: code=%d out=%q", code, out)
	}
	code, out, _ = do(t, text, "--profile", "upstream")
	if strings.Contains(out, "contraction") || strings.Contains(out, "(STE-") || code != 1 {
		t.Errorf("upstream: code=%d out=%q", code, out)
	}
	_, out, _ = do(t, text, "--json")
	if !strings.Contains(out, `"spec": "STE-4.2"`) {
		t.Errorf("--json must carry the spec: %s", out)
	}
	_, out, _ = do(t, strings.Repeat("word ", 22)+".\n", "--profile", "procedure")
	if !strings.Contains(out, "procedure-length") {
		t.Errorf("procedure must apply the 20-word limit: %q", out)
	}
	if code, _, errs := do(t, "", "--profile", "nope"); code != 2 || errs == "" {
		t.Errorf("an unknown profile is a usage error: code=%d", code)
	}
}

func TestFilesAreMergedAndNamed(t *testing.T) {
	d := t.TempDir()
	a, b := filepath.Join(d, "a.md"), filepath.Join(d, "b.md")
	os.WriteFile(a, []byte("Close the valve; open the door.\n"), 0o644)
	os.WriteFile(b, []byte("Open the door; close the valve.\n"), 0o644)
	code, out, _ := do(t, "", a, b)
	if code != 1 || !strings.Contains(out, a+":1:") || !strings.Contains(out, b+":1:") || !strings.Contains(out, "2 violations (2 hard") {
		t.Errorf("code=%d out=%q", code, out)
	}
}

func TestUsageErrors(t *testing.T) {
	for _, args := range [][]string{{"--nope"}, {"--baseline"}, {"--baseline", "x"}, {"--baseline", "-1"}, {"--disable"}, {"/no/such/file.md"}} {
		if code, _, errs := do(t, "", args...); code != 2 || errs == "" {
			t.Errorf("%v: code=%d err=%q, want 2 and a message", args, code, errs)
		}
	}
	if code, out, _ := do(t, "", "version"); code != 0 || strings.TrimSpace(out) == "" {
		t.Errorf("version: code=%d out=%q", code, out)
	}
}
