package workspace

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A failing check without its jobs and log tail only says "this broke". Node caps both — five
// jobs and one log tail each — because an unbounded list is an unbounded number of `gh api` calls
// and an unbounded log is an unbounded frame.
func TestCheckDetailsCapsFailedJobsAndLogTail(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()

	jobs := `{"jobs":[`
	for i := 1; i <= 7; i++ {
		if i > 1 {
			jobs += ","
		}
		jobs += `{"id":` + itoa(100+i) + `,"name":"job-` + itoa(i) + `","status":"completed","conclusion":"failure","html_url":"https://gh/job/` + itoa(i) + `"}`
	}
	jobs += `,{"id":200,"name":"ok-job","status":"completed","conclusion":"success"}]}`

	// 300 numbered lines, so the tail cap is observable: the last 200 survive.
	logLines := make([]string, 0, 300)
	for i := 1; i <= 300; i++ {
		logLines = append(logLines, "line-"+itoa(i))
	}
	script := `#!/bin/sh
case "$*" in
  *actions/runs/*/jobs*) printf '%s' '` + jobs + `' ;;
  *actions/jobs/*/logs*) printf '%s\n' '` + strings.Join(logLines, "\n") + `' ;;
  *annotations*) echo '[]' ;;
  *) echo '{"id":42,"name":"build","status":"completed","conclusion":"failure","html_url":"https://gh/1","details_url":"https://gh/2","check_suite":{"workflow_run_id":77}}' ;;
esac
`
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	details, err := CheckDetails(t.Context(), "github", dir, 42)
	if err != nil {
		t.Fatal(err)
	}
	failed, ok := details["failedJobs"].([]map[string]any)
	if !ok {
		t.Fatalf("failedJobs: %+v", details["failedJobs"])
	}
	if len(failed) != failedCheckJobLimit {
		t.Fatalf("failedJobs = %d, want the %d-entry cap", len(failed), failedCheckJobLimit)
	}
	if failed[0]["jobId"] != int64(101) || failed[0]["name"] != "job-1" || failed[0]["conclusion"] != "failure" {
		t.Fatalf("first failed job: %+v", failed[0])
	}
	tail, _ := failed[0]["logTail"].(string)
	lines := strings.Split(strings.TrimRight(tail, "\n"), "\n")
	if len(lines) != checkLogTailMaxLines {
		t.Fatalf("log tail lines = %d, want %d", len(lines), checkLogTailMaxLines)
	}
	if lines[len(lines)-1] != "line-300" {
		t.Fatalf("log tail must keep the END of the log, got %q", lines[len(lines)-1])
	}
	if failed[0]["logTruncated"] != true {
		t.Fatal("logTruncated must be true when the log was cut")
	}
	// Seven failed jobs, five kept, plus five truncated logs: the panel has to be able to say so.
	if details["truncated"] != true {
		t.Fatalf("truncated = %v, want true", details["truncated"])
	}
}

// Under the caps nothing is reported as truncated, so the panel does not warn about missing data
// that is not missing.
func TestCheckDetailsReportsCompleteWhenUnderCaps(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	script := `#!/bin/sh
case "$*" in
  *actions/runs/*/jobs*) echo '{"jobs":[{"id":101,"name":"job-1","status":"completed","conclusion":"failure","html_url":"https://gh/job/1"}]}' ;;
  *actions/jobs/*/logs*) printf 'only one line\n' ;;
  *annotations*) echo '[]' ;;
  *) echo '{"id":42,"name":"build","status":"completed","conclusion":"failure","check_suite":{"workflow_run_id":77}}' ;;
esac
`
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	details, err := CheckDetails(t.Context(), "github", dir, 42)
	if err != nil {
		t.Fatal(err)
	}
	failed, _ := details["failedJobs"].([]map[string]any)
	if len(failed) != 1 {
		t.Fatalf("failedJobs = %+v", details["failedJobs"])
	}
	if failed[0]["logTail"] != "only one line" || failed[0]["logTruncated"] != false {
		t.Fatalf("log tail: %+v", failed[0])
	}
	if details["truncated"] != false {
		t.Fatalf("truncated = %v, want false", details["truncated"])
	}
}

func TestUTF8SuffixWithinBytesKeepsRunesWhole(t *testing.T) {
	// Three-byte runes: cutting at a byte boundary must not produce a replacement character.
	value := strings.Repeat("世", 100)
	tail := utf8SuffixWithinBytes(value, 10)
	if !strings.HasPrefix(value, strings.Repeat("世", 100-len([]rune(tail)))) {
		t.Fatalf("suffix %q is not a suffix of the original", tail)
	}
	if strings.ContainsRune(tail, '�') {
		t.Fatalf("suffix split a rune: %q", tail)
	}
	if len(tail) != 9 {
		t.Fatalf("suffix length = %d, want the largest multiple of 3 under 10", len(tail))
	}
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[i:])
}
