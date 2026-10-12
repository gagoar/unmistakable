// Package repocheck holds tests about the repository itself: the manifests, the skill, the
// docs and the committed binaries. It has no code.
package repocheck

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func root(t *testing.T) string {
	t.Helper()
	r, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func read(t *testing.T, parts ...string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(append([]string{root(t)}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

type manifest struct {
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	Skills   []string `json:"skills"`
	License  string   `json:"license"`
	Homepage string   `json:"homepage"`
}

func pluginJSON(t *testing.T) manifest {
	t.Helper()
	var m manifest
	if err := json.Unmarshal([]byte(read(t, ".claude-plugin", "plugin.json")), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestNoThirdPartyModules(t *testing.T) {
	if regexp.MustCompile(`(?m)^\s*require\b`).MatchString(read(t, "go.mod")) {
		t.Error("go.mod must have no require: the project uses the standard library only")
	}
}

func TestPluginManifest(t *testing.T) {
	m := pluginJSON(t)
	if m.Name != "unmistakable" {
		t.Errorf("plugin name = %q", m.Name)
	}
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(m.Version) {
		t.Errorf("version %q is not semver", m.Version)
	}
	if m.License != "MIT" {
		t.Errorf("license = %q", m.License)
	}
	if len(m.Skills) == 0 {
		t.Fatal("the plugin lists no skill")
	}
	for _, s := range m.Skills {
		if _, err := os.Stat(filepath.Join(root(t), s, "SKILL.md")); err != nil {
			t.Errorf("skill path %s has no SKILL.md: %v", s, err)
		}
	}

	var mk struct {
		Plugins []struct {
			Name   string `json:"name"`
			Source string `json:"source"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal([]byte(read(t, ".claude-plugin", "marketplace.json")), &mk); err != nil {
		t.Fatal(err)
	}
	if len(mk.Plugins) != 1 || mk.Plugins[0].Name != m.Name || mk.Plugins[0].Source != "./" {
		t.Errorf("the marketplace must list this plugin once, from ./: %+v", mk.Plugins)
	}
}

// The footer of every page in docs/ shows the version in plugin.json.
func TestDocsFootersShowThePluginVersion(t *testing.T) {
	want := "unmistakable v" + pluginJSON(t).Version
	pages, _ := filepath.Glob(filepath.Join(root(t), "docs", "*.html"))
	if len(pages) == 0 {
		t.Fatal("no pages in docs/")
	}
	for _, p := range pages {
		b, _ := os.ReadFile(p)
		if !strings.Contains(string(b), want) {
			t.Errorf("%s: the footer must show %q", filepath.Base(p), want)
		}
	}
}

var frontmatter = regexp.MustCompile(`(?s)\A---\n(.*?)\n---\n`)

func TestSkill(t *testing.T) {
	text := read(t, "skills", "asd-ste100", "SKILL.md")
	fm := frontmatter.FindStringSubmatch(text)
	if fm == nil {
		t.Fatal("SKILL.md has no frontmatter")
	}
	if !regexp.MustCompile(`(?m)^name: asd-ste100$`).MatchString(fm[1]) {
		t.Error("the skill keeps the name asd-ste100: pr-brief invokes it by that name")
	}
	if !regexp.MustCompile(`(?m)^description: .{40,}`).MatchString(fm[1]) {
		t.Error("the skill needs a description")
	}
	// The Python linter is not shipped. The skill must point at the Go binary.
	err := filepath.Walk(filepath.Join(root(t), "skills"), func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		b, _ := os.ReadFile(p)
		if strings.Contains(string(b), "ste-lint.py") && !strings.Contains(p, "UPSTREAM") {
			t.Errorf("%s mentions ste-lint.py, which this plugin does not ship", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "bin/ste-lint") {
		t.Error("SKILL.md must tell the reader to run bin/ste-lint")
	}
	if _, err := os.Stat(filepath.Join(root(t), "skills", "asd-ste100", "scripts")); err == nil {
		t.Error("skills/asd-ste100/scripts must not exist")
	}
}

// ASD owns the ASD-STE100 mark and does not endorse tools. The marketing copy must not claim
// otherwise. The skill is left out: it states, as a non-goal, that it does not produce
// STE-compliant documents.
func TestNoComplianceClaims(t *testing.T) {
	negated := regexp.MustCompile(`(?:\bnot|\bno|\bnever|n't|\bnor)\s+(?:\w+,?\s+){0,4}$`)
	banned := regexp.MustCompile(`(?i)\b(ste-compliant|ste100-compliant|ste 100 compliant|asd-certified|ste-certified|fully compliant|endorsed by asd|asd-approved)\b`)
	var files []string
	for _, g := range []string{"README.md", "docs/*.html", ".claude-plugin/*.json"} {
		m, _ := filepath.Glob(filepath.Join(root(t), g))
		files = append(files, m...)
	}
	for _, f := range files {
		b, _ := os.ReadFile(f)
		text := string(b)
		for _, loc := range banned.FindAllStringIndex(text, -1) {
			// "not endorsed by ASD" is the disclaimer. Only a claim is a failure.
			before := strings.ToLower(text[max(0, loc[0]-60):loc[0]])
			if negated.MatchString(before) {
				continue
			}
			t.Errorf("%s says %q: claim no compliance, certification or endorsement", f, text[loc[0]:loc[1]])
		}
	}
}

func TestBinariesAreCommitted(t *testing.T) {
	for _, n := range []string{"ste-lint", "ste-lint-darwin-amd64", "ste-lint-darwin-arm64", "ste-lint-linux-amd64", "ste-lint-linux-arm64", "ste-lint-windows-amd64.exe"} {
		st, err := os.Stat(filepath.Join(root(t), "bin", n))
		if err != nil {
			t.Errorf("bin/%s is missing: run ./build.sh", n)
			continue
		}
		if n != "ste-lint-windows-amd64.exe" && st.Mode()&0o111 == 0 {
			t.Errorf("bin/%s is not executable", n)
		}
	}
	// The launcher runs on a machine that has the binaries and nothing else.
	cmd := exec.Command(filepath.Join(root(t), "bin", "ste-lint"), "version")
	if out, err := cmd.CombinedOutput(); err != nil || !strings.Contains(string(out), pluginJSON(t).Version) {
		t.Errorf("bin/ste-lint version = %q (%v), want the plugin version", out, err)
	}
}

// The plugin directory holds back a plugin that pre-approves a write or exec tool with no scope,
// that copies the whole environment, or that commits a native executable it cannot read.
// This is the same gate as iceberg's check-plugin-safety, in Go.
func TestPluginSafety(t *testing.T) {
	unscoped := regexp.MustCompile(`(?m)^\s*(?:allowed-tools|allowed_tools|tools)\s*:.*\b(?:Write|Edit|MultiEdit|NotebookEdit|Bash)\b(?:\s*(?:,|$|\n))`)
	grant := regexp.MustCompile(`(?m)^\s*-\s*(?:Write|Edit|MultiEdit|NotebookEdit|Bash)\s*$`)
	var goFiles, skillFiles []string
	err := filepath.Walk(root(t), func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root(t), p)
		if info.IsDir() {
			if rel == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		switch {
		case strings.HasSuffix(p, ".go") && !strings.HasSuffix(p, "_test.go"):
			goFiles = append(goFiles, p)
		case strings.HasPrefix(rel, "skills"+string(filepath.Separator)) && strings.HasSuffix(p, ".md"):
			skillFiles = append(skillFiles, p)
		case strings.HasPrefix(rel, "bin"+string(filepath.Separator)):
			// The binaries are rebuilt in CI and must equal the committed bytes.
		case info.Mode()&0o111 != 0 && !strings.HasSuffix(p, ".sh"):
			t.Errorf("%s is executable: only bin/ and build scripts may be", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range skillFiles {
		b, _ := os.ReadFile(f)
		fm := frontmatter.FindStringSubmatch(string(b))
		if fm != nil && (unscoped.MatchString(fm[1]) || grant.MatchString(fm[1])) {
			t.Errorf("%s pre-approves a write or exec tool with no path scope", f)
		}
	}
	for _, f := range goFiles {
		b, _ := os.ReadFile(f)
		if strings.Contains(string(b), "os.Environ(") {
			t.Errorf("%s copies the whole environment: read named variables instead", f)
		}
	}
}

// The sample output in the README must be what the committed binary prints. Nobody edits it by hand.
func TestReadmeSampleIsRealOutput(t *testing.T) {
	readme := read(t, "README.md")
	const lead = "$ echo \"We spin up the box; it isn't running.\" | ste-lint\n"
	i := strings.Index(readme, lead)
	if i < 0 {
		t.Fatal("the README has no linter sample")
	}
	block := readme[i+len(lead):]
	block = block[:strings.Index(block, "\n```")]
	cmd := exec.Command(filepath.Join(root(t), "bin", "ste-lint"))
	cmd.Stdin = strings.NewReader("We spin up the box; it isn't running.\n")
	out, _ := cmd.Output() // exit 1 is the point: the sample has hard findings
	if strings.TrimRight(string(out), "\n") != strings.TrimRight(block, "\n") {
		t.Errorf("the README sample differs from the real output:\n--- README ---\n%s\n--- bin/ste-lint ---\n%s", block, out)
	}
}
