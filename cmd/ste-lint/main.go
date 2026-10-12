// Command ste-lint checks English text against the structural rules of the asd-ste100 skill.
// It is a Go port of the skill's scripts/ste-lint.py and takes the same arguments.
package main

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/gagoar/unmistakable/internal/stelint"
)

// version is set at build time by build.sh.
var version = "0.0.0-dev"

const usage = `usage: ste-lint [--profile agent|descriptive|procedure|upstream] [--json] [--baseline N] [--disable rule,rule] [FILE...]
       ste-lint version

Reads FILE arguments, or stdin when there are none. The profile picks the rules (default agent):
  agent        every check, for text that an AI agent reads
  descriptive  the checks that follow a numbered STE rule, 25 words per sentence
  procedure    descriptive, with 20 words per sentence
  upstream     exactly the checks of the original ste-lint.py, with its output byte for byte Exit 0 when the hard violations do not
exceed the baseline (default 0), 1 when they do, 2 for a usage error.`

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 1 && args[0] == "version" {
		fmt.Fprintln(stdout, version)
		return 0
	}
	var (
		asJSON bool
		opts   = stelint.Options{Profile: stelint.ProfileAgent}
		paths  []string
	)
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-h" || a == "--help":
			fmt.Fprintln(stdout, usage)
			return 0
		case a == "--json":
			asJSON = true
		case a == "--baseline" || a == "--disable" || a == "--profile":
			i++
			if i >= len(args) {
				fmt.Fprintf(stderr, "ste-lint: %s needs a value\n%s\n", a, usage)
				return 2
			}
			if a == "--disable" {
				opts.Disable = strings.Split(args[i], ",")
				break
			}
			if a == "--profile" {
				p, ok := stelint.ParseProfile(args[i])
				if !ok {
					fmt.Fprintf(stderr, "ste-lint: unknown profile %q\n%s\n", args[i], usage)
					return 2
				}
				opts.Profile = p
				break
			}
			n, err := strconv.Atoi(args[i])
			if err != nil || n < 0 {
				fmt.Fprintf(stderr, "ste-lint: --baseline needs a whole number, not %q\n", args[i])
				return 2
			}
			opts.Baseline = n
		case strings.HasPrefix(a, "--"):
			fmt.Fprintf(stderr, "ste-lint: unknown flag %s\n%s\n", a, usage)
			return 2
		default:
			paths = append(paths, a)
		}
	}

	var rep stelint.Report
	if len(paths) == 0 {
		text, err := io.ReadAll(stdin)
		if err != nil {
			fmt.Fprintln(stderr, "ste-lint:", err)
			return 2
		}
		rep = stelint.Lint(string(text), opts)
	} else {
		var reps []stelint.Report
		for _, p := range paths {
			text, err := os.ReadFile(p)
			if err != nil {
				fmt.Fprintln(stderr, "ste-lint:", err)
				return 2
			}
			reps = append(reps, stelint.LintNamed(string(text), p, opts))
		}
		rep = stelint.Merge(opts, reps...)
	}

	if asJSON {
		data, err := rep.JSON()
		if err != nil {
			fmt.Fprintln(stderr, "ste-lint:", err)
			return 2
		}
		fmt.Fprintln(stdout, string(data))
	} else {
		for _, v := range rep.Violations {
			name := v.Rule
			if v.Spec != "" {
				name += " (" + v.Spec + ")"
			}
			fmt.Fprintf(stdout, "%s:%d:%d %s: %s [%s]\n", v.File, v.Line, v.Col, name, v.Message, v.Match)
		}
		fmt.Fprintf(stdout, "\n%d violations (%d hard, baseline %d), %d words, %s per 100 words\n",
			rep.Count, rep.HardCount, rep.Baseline, rep.Words, strconv.FormatFloat(rep.Per100Words, 'f', 1, 64))
		fmt.Fprintln(stdout, "Hedges/modality (may, might, could) are never flagged: confidence is content.")
	}
	if rep.Failed() {
		return 1
	}
	return 0
}
