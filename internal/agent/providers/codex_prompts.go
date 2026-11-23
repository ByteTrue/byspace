package providers

import (
	"context"
	"github.com/ByteTrue/byspace/internal/proc"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

type codexSkill struct {
	command sdk.SlashCommand
	path    string
}

func codexHomeDir() string {
	if home := strings.TrimSpace(os.Getenv("CODEX_HOME")); home != "" {
		return home
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".codex")
}

func parseCodexFrontMatter(markdown string) (map[string]string, string) {
	lines := strings.Split(markdown, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return map[string]string{}, markdown
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return map[string]string{}, markdown
	}
	metadata := map[string]string{}
	for _, line := range lines[1:end] {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, value, _ := strings.Cut(trimmed, ":")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		value = strings.TrimPrefix(strings.TrimPrefix(value, "'"), "\"")
		value = strings.TrimSuffix(strings.TrimSuffix(value, "'"), "\"")
		if key != "" && value != "" {
			metadata[key] = value
		}
	}
	return metadata, strings.Join(lines[end+1:], "\n")
}

func listCodexCustomPrompts(home string) []sdk.SlashCommand {
	entries, err := os.ReadDir(filepath.Join(home, "prompts"))
	if err != nil {
		return nil
	}
	commands := []sdk.SlashCommand{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".md")
		content, err := os.ReadFile(filepath.Join(home, "prompts", entry.Name()))
		if name == "" || err != nil {
			continue
		}
		metadata, _ := parseCodexFrontMatter(string(content))
		description := metadata["description"]
		if description == "" {
			description = "Custom prompt"
		}
		hint := metadata["argument-hint"]
		if hint == "" {
			hint = metadata["argument_hint"]
		}
		commands = append(commands, sdk.SlashCommand{Name: "prompts:" + name, Description: description, ArgumentHint: hint, Kind: "command", Source: "prompt"})
	}
	sort.Slice(commands, func(i, j int) bool { return commands[i].Name < commands[j].Name })
	return commands
}

func loadCodexCustomPrompt(home, name string) (string, bool) {
	trimmed := strings.TrimPrefix(name, "prompts:")
	if trimmed == name || strings.Contains(trimmed, "/") || strings.Contains(trimmed, "\\") {
		return "", false
	}
	content, err := os.ReadFile(filepath.Join(home, "prompts", trimmed+".md"))
	if err != nil {
		return "", false
	}
	_, body := parseCodexFrontMatter(string(content))
	return body, true
}

func tokenizeCodexCommandArgs(input string) []string {
	var tokens []string
	var current strings.Builder
	var quote rune
	escaped := false
	for _, char := range input {
		if escaped {
			switch char {
			case 'n':
				current.WriteRune('\n')
			case 't':
				current.WriteRune('\t')
			default:
				current.WriteRune(char)
			}
			escaped = false
			continue
		}
		if quote != 0 {
			if char == quote {
				quote = 0
			} else if char == '\\' {
				escaped = true
			} else {
				current.WriteRune(char)
			}
			continue
		}
		if char == '\'' || char == '"' {
			quote = char
			continue
		}
		if char == ' ' || char == '\t' || char == '\r' || char == '\n' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			continue
		}
		current.WriteRune(char)
	}
	if escaped {
		current.WriteRune('\\')
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

var codexPlaceholderPattern = regexp.MustCompile("\\$([A-Za-z_][A-Za-z0-9_-]*|[1-9]|\\$)")

func expandCodexCustomPrompt(template, args string) string {
	trimmed := strings.TrimSpace(args)
	tokens := tokenizeCodexCommandArgs(trimmed)
	named := map[string]string{}
	positional := []string{}
	for _, token := range tokens {
		key, value, ok := strings.Cut(token, "=")
		if ok && key != "" {
			named[key] = value
		} else {
			positional = append(positional, token)
		}
	}
	return codexPlaceholderPattern.ReplaceAllStringFunc(template, func(match string) string {
		name := strings.TrimPrefix(match, "$")
		switch name {
		case "$":
			return "$"
		case "ARGUMENTS":
			return trimmed
		}
		if len(name) == 1 && name[0] >= '1' && name[0] <= '9' {
			index := int(name[0] - '1')
			if index < len(positional) {
				return positional[index]
			}
			return ""
		}
		if value, ok := named[name]; ok {
			return value
		}
		return match
	})
}

func listCodexSkills(cwd, home string) []codexSkill {
	candidates := []string{filepath.Join(cwd, ".codex", "skills")}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	root, err := proc.CommandContext(ctx, "git", "-C", cwd, "rev-parse", "--show-toplevel").Output()
	cancel()
	if err == nil && strings.TrimSpace(string(root)) != "" {
		repo := strings.TrimSpace(string(root))
		candidates = append(candidates, filepath.Join(filepath.Dir(cwd), ".codex", "skills"), filepath.Join(repo, ".codex", "skills"))
	}
	candidates = append(candidates, filepath.Join(home, "skills"))
	byName := map[string]codexSkill{}
	for _, directory := range candidates {
		entries, err := os.ReadDir(directory)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
				continue
			}
			path := filepath.Join(directory, entry.Name(), "SKILL.md")
			content, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			metadata, _ := parseCodexFrontMatter(string(content))
			name, description := metadata["name"], metadata["description"]
			if name == "" || description == "" {
				continue
			}
			if _, exists := byName[name]; !exists {
				byName[name] = codexSkill{command: sdk.SlashCommand{Name: name, Description: description, Kind: "skill", Source: "skill"}, path: path}
			}
		}
	}
	keys := make([]string, 0, len(byName))
	for name := range byName {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	result := make([]codexSkill, 0, len(keys))
	for _, name := range keys {
		result = append(result, byName[name])
	}
	return result
}
