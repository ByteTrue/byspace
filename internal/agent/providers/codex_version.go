package providers

import (
	"context"
	"github.com/ByteTrue/byspace/internal/proc"
	"regexp"
	"strconv"
	"time"
)

var codexVersionPattern = regexp.MustCompile(`([0-9]+)[.]([0-9]+)[.]([0-9]+)`)

func codexVersionAtLeast(versionOutput string, major, minor, patch int) bool {
	matches := codexVersionPattern.FindStringSubmatch(versionOutput)
	if len(matches) != 4 {
		return false
	}
	var found [3]int
	for index := range found {
		found[index], _ = strconv.Atoi(matches[index+1])
	}
	minimum := [3]int{major, minor, patch}
	for index := range found {
		if found[index] != minimum[index] {
			return found[index] > minimum[index]
		}
	}
	return true
}

func codexBinarySupportsGoals(binary string, commandArgs ...string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	args := append(append([]string(nil), commandArgs...), "--version")
	output, err := proc.CommandContext(ctx, binary, args...).CombinedOutput()
	return err == nil && codexVersionAtLeast(string(output), 0, 128, 0)
}
