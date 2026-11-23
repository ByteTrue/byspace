//go:build !linux && !windows && !darwin

package filewatch

import (
	"errors"
	"testing"
)

func TestOpenReportsUnsupportedPlatform(t *testing.T) {
	obs, err := Open()
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("Open returned %v, want ErrUnsupported", err)
	}
	if obs != nil {
		t.Fatalf("Open returned an observation together with %v", err)
	}
}
