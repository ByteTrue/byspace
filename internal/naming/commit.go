package naming

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// CommitMessagePrompt asks for a conventional commit subject.
//
// The diff is fed as context rather than asking the model to run git: it already has the diff,
// and a provider that runs a command to fetch it would need the same permissions the daemon has.
const CommitMessagePrompt = `Write a git commit message for the staged changes below.

Rules:
- One line, imperative mood, at most 72 characters ("add", not "added"/"adds").
- No trailing period. No quotes around it. No "commit message:" prefix.
- Say what changed and why it matters, not which files were touched.
- Reply with the message only.

Diff:
`

// PRTextPrompt asks for a pull request title and body.
const PRTextPrompt = `Write a pull request title and body for the changes below.

Rules:
- Title: one line, at most 72 characters, imperative mood.
- Body: 1-3 short paragraphs — what changed, why, and anything a reviewer must know.
- No headings, no bullet lists, no "Summary:" prefix.

Reply with JSON only, in exactly this shape:
{"title":"...","body":"..."}

Diff:
`

// PRText is a generated pull request title and body.
type PRText struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// GenerateCommitMessage asks the model for a commit subject.
//
// Returns an error rather than an empty string so the caller can refuse the commit: git with an
// empty -m opens an editor and hangs a daemon that has no terminal.
func (g PiGenerator) GenerateCommitMessage(ctx context.Context, diff string) (string, error) {
	reply, err := g.run(ctx, CommitMessagePrompt, diff)
	if err != nil {
		return "", err
	}
	line := cleanCommitMessage(reply)
	if line == "" {
		return "", errors.New("model returned no commit message")
	}
	return line, nil
}

// GeneratePRText asks the model for a pull request title and body.
func (g PiGenerator) GeneratePRText(ctx context.Context, diff string) (PRText, error) {
	reply, err := g.run(ctx, PRTextPrompt, diff)
	if err != nil {
		return PRText{}, err
	}
	jsonStart := strings.IndexByte(reply, '{')
	jsonEnd := strings.LastIndexByte(reply, '}')
	if jsonStart < 0 || jsonEnd <= jsonStart {
		return PRText{}, errors.New("model reply had no JSON object")
	}
	var text PRText
	if err := json.Unmarshal([]byte(reply[jsonStart:jsonEnd+1]), &text); err != nil {
		return PRText{}, fmt.Errorf("model reply was not the expected JSON: %w", err)
	}
	text.Title = strings.TrimSpace(text.Title)
	text.Body = strings.TrimSpace(text.Body)
	if text.Title == "" {
		return PRText{}, errors.New("model returned no title")
	}
	return text, nil
}

// run sends one prompt to a short-lived pi process and returns its reply.
func (g PiGenerator) run(ctx context.Context, prompt, seed string) (string, error) {
	sess, err := pi.StartSession(pi.LaunchOptions{
		Command:   g.Command,
		Model:     g.Model,
		NoSession: true,
	})
	if err != nil {
		return "", err
	}
	defer sess.Close()

	if err := sess.Prompt(ctx, prompt+seed, nil); err != nil {
		return "", err
	}
	if err := sess.WaitForFinish(ctx); err != nil {
		return "", err
	}
	reply := sess.LastAssistantText()
	if strings.TrimSpace(reply) == "" {
		return "", errors.New("model returned no text")
	}
	return reply, nil
}
