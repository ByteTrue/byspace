package providers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCodexCustomPromptMetadataAndExpansion(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "prompts"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "---\ndescription: Review code\nargument-hint: '[file] [focus]'\n---\nReview $1 with $focus. All: $ARGUMENTS. Dollar: $$ Missing: $2"
	if err := os.WriteFile(filepath.Join(home, "prompts", "review.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	commands := listCodexCustomPrompts(home)
	if len(commands) != 1 || commands[0].Name != "prompts:review" || commands[0].ArgumentHint != "[file] [focus]" {
		t.Fatalf("commands = %#v", commands)
	}
	body, ok := loadCodexCustomPrompt(home, "prompts:review")
	if !ok {
		t.Fatal("prompt not found")
	}
	expanded := expandCodexCustomPrompt(body, "main.go focus=\"error handling\"")
	want := "Review main.go with error handling. All: main.go focus=\"error handling\". Dollar: $ Missing: "
	if expanded != want {
		t.Fatalf("expanded = %q, want %q", expanded, want)
	}
}

func TestCodexSkillDiscoveryDedupesNearest(t *testing.T) {
	home, cwd := t.TempDir(), t.TempDir()
	for _, root := range []string{home, filepath.Join(cwd, ".codex")} {
		directory := filepath.Join(root, "skills", "review")
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		description := "home description"
		if root != home {
			description = "workspace description"
		}
		if err := os.WriteFile(filepath.Join(directory, "SKILL.md"), []byte("---\nname: review\ndescription: "+description+"\n---\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	skills := listCodexSkills(cwd, home)
	if len(skills) != 1 || skills[0].command.Description != "workspace description" || skills[0].command.Kind != "skill" {
		t.Fatalf("skills = %#v", skills)
	}
}
