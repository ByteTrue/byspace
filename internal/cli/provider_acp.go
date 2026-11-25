package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/store"
)

var providerIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

func runProviderCheckCmd(args []string, stdout io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: byspace provider check <id>")
	}
	id := strings.TrimSpace(args[0])
	resolvedHome, err := home.Resolve("")
	if err != nil {
		return err
	}
	config := store.New(resolvedHome).LoadDaemonConfig()
	configured, _ := config["providers"].(map[string]any)
	entry, ok := configured[id].(map[string]any)
	if !ok {
		return fmt.Errorf("provider %q is not configured", id)
	}
	if enabled, exists := entry["enabled"].(bool); exists && !enabled {
		return fmt.Errorf("provider %q is disabled", id)
	}
	if extends, _ := entry["extends"].(string); extends != "acp" {
		return fmt.Errorf("provider %q does not extend ACP", id)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	report := providers.RunACPConformance(ctx, id, entry)
	for _, result := range report.Results {
		fmt.Fprintf(stdout, "%s %s", result.Status, result.Name)
		if result.Detail != "" {
			fmt.Fprintf(stdout, " - %s", result.Detail)
		}
		fmt.Fprintln(stdout)
	}
	if !report.Passed() {
		return fmt.Errorf("provider %s failed ACP conformance", id)
	}
	fmt.Fprintf(stdout, "provider %s passed ACP conformance\n", id)
	return nil
}

func runProviderAddCmd(args []string, stdout io.Writer) error {
	if len(args) == 0 || args[0] != "acp" {
		return errors.New("usage: byspace provider add acp --id <id> --label <label> -- <argv...>")
	}
	fs := flag.NewFlagSet("provider add acp", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	id := fs.String("id", "", "provider ID")
	label := fs.String("label", "", "provider label")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	*id = strings.TrimSpace(*id)
	*label = strings.TrimSpace(*label)
	argv := fs.Args()
	if !providerIDPattern.MatchString(*id) {
		return fmt.Errorf("invalid provider ID %q: must match %s", *id, providerIDPattern)
	}
	for _, builtin := range providers.BuiltinProviders {
		if builtin.ID == *id {
			return fmt.Errorf("provider ID %q is built in", *id)
		}
	}
	if *label == "" {
		return errors.New("provider label cannot be empty")
	}
	if len(argv) == 0 {
		return errors.New("provider launch argv cannot be empty; put it after --")
	}
	for _, arg := range argv {
		if strings.TrimSpace(arg) == "" {
			return errors.New("provider launch argv cannot contain empty arguments")
		}
	}
	entry := map[string]any{"extends": "acp", "label": *label, "command": argv}
	resolvedHome, err := home.Resolve("")
	if err != nil {
		return err
	}
	st := store.New(resolvedHome)
	if existing, ok := st.LoadDaemonConfig()["providers"].(map[string]any)[*id]; ok {
		existingJSON, _ := json.Marshal(existing)
		entryJSON, _ := json.Marshal(entry)
		if bytes.Equal(existingJSON, entryJSON) {
			fmt.Fprintf(stdout, "provider %s unchanged\n", *id)
			return nil
		}
		return fmt.Errorf("provider %q already exists with a different configuration", *id)
	}
	if _, err := st.SaveDaemonConfigChecked(map[string]any{
		"providers": map[string]any{*id: entry},
	}); err != nil {
		return fmt.Errorf("save provider %q: %w", *id, err)
	}
	fmt.Fprintf(stdout, "added provider %s\n", *id)
	return nil
}
