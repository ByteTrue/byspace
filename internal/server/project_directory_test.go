package server

import "testing"

// An absolute path, a drive prefix or `..` would put the directory outside the parent the user
// selected, so they are rejected before the filesystem is touched.
func TestValidateProjectDirectoryName(t *testing.T) {
	valid := []string{"my-project", "a", "with space", "_under"}
	for _, name := range valid {
		if err := ValidateProjectDirectoryName(name); err != nil {
			t.Fatalf("%q should be valid: %v", name, err)
		}
	}
	invalid := []string{
		"", "   ", " padded", "trailing ", ".", "..",
		"a/b", `a\b`, "/abs/path", "C:drive", "with\x00nul",
	}
	for _, name := range invalid {
		if err := ValidateProjectDirectoryName(name); err == nil {
			t.Fatalf("%q should have been rejected", name)
		}
	}
}
