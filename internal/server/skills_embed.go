package server

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

//go:embed all:skills
var bundledSkillsFS embed.FS

var (
	extractedSkillsOnce sync.Once
	extractedSkillsDir  string
)

func extractBundledSkills() string {
	extractedSkillsOnce.Do(func() {
		dir, err := os.MkdirTemp("", "byspace-bundled-skills-*")
		if err != nil {
			return
		}
		err = fs.WalkDir(bundledSkillsFS, "skills", func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel, relErr := filepath.Rel("skills", path)
			if relErr != nil || rel == "." {
				return nil
			}
			target := filepath.Join(dir, rel)
			if d.IsDir() {
				return os.MkdirAll(target, 0o755)
			}
			data, readErr := bundledSkillsFS.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			if mkErr := os.MkdirAll(filepath.Dir(target), 0o755); mkErr != nil {
				return mkErr
			}
			return os.WriteFile(target, data, 0o644)
		})
		if err == nil {
			extractedSkillsDir = dir
		}
	})
	return extractedSkillsDir
}
