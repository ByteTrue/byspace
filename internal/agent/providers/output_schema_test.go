package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// Codex structured outputs need every object closed and fully required; Node normalized the schema
// before sending it, and refused one that left additionalProperties open.
func TestNormalizeCodexOutputSchema(t *testing.T) {
	var schema map[string]any
	_ = json.Unmarshal([]byte(`{
		"type": "object",
		"properties": {
			"summary": {"type": "string"},
			"items": {"type": "array", "items": {"type": "object", "properties": {"b": {"type": "string"}, "a": {"type": "number"}}}}
		},
		"required": ["summary"]
	}`), &schema)
	got, err := normalizeCodexOutputSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	if got["additionalProperties"] != false || !reflect.DeepEqual(got["required"], []any{"summary", "items"}) {
		t.Fatalf("root = %v", got)
	}
	item := got["properties"].(map[string]any)["items"].(map[string]any)["items"].(map[string]any)
	if item["additionalProperties"] != false || !reflect.DeepEqual(item["required"], []any{"a", "b"}) {
		t.Fatalf("nested object = %v", item)
	}

	for _, bad := range []string{
		`"not an object"`,
		`{"type": "string"}`,
		`{"type": "object", "properties": {"a": {"type": "string"}}, "additionalProperties": true}`,
	} {
		var input any
		_ = json.Unmarshal([]byte(bad), &input)
		if _, err := normalizeCodexOutputSchema(input); err == nil {
			t.Fatalf("%s should be rejected", bad)
		}
	}
}

// The schema rides on the next turn/start and only that one.
func TestCodexPromptCarriesTheOutputSchema(t *testing.T) {
	reader, writer := io.Pipe()
	session := &CodexSession{stdin: writer, pending: map[int64]chan map[string]any{}, threadID: "thread-1"}
	session.frames = sdk.NewStreamFrames(session.flushFramesOnTimer)
	requests := make(chan map[string]any, 4)
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var request map[string]any
			_ = json.Unmarshal(scanner.Bytes(), &request)
			requests <- request
			// Answer so Prompt returns.
			id := int64(request["id"].(float64))
			session.mu.Lock()
			ch := session.pending[id]
			delete(session.pending, id)
			session.mu.Unlock()
			if ch != nil {
				ch <- map[string]any{"result": map[string]any{}}
			}
		}
	}()

	if err := session.SetNextOutputSchema(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for turn := 0; turn < 2; turn++ {
		if err := session.Prompt(ctx, "hello", nil); err != nil {
			t.Fatal(err)
		}
		var request map[string]any
		for {
			request = <-requests
			if request["method"] == "turn/start" {
				break
			}
		}
		params := request["params"].(map[string]any)
		schema, has := params["outputSchema"].(map[string]any)
		if turn == 0 && (!has || schema["additionalProperties"] != false) {
			t.Fatalf("first turn params = %v", params)
		}
		if turn == 1 && has {
			t.Fatalf("the schema leaked into the next turn: %v", params)
		}
	}
	if err := session.SetNextOutputSchema("nope"); err == nil {
		t.Fatal("a non-object schema must be refused")
	}
}

// OpenCode receives the schema as the prompt's json_schema format.
func TestOpenCodePromptCarriesTheOutputSchema(t *testing.T) {
	bodies := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/message") {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			bodies <- body
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"parts":[]}`))
	}))
	defer server.Close()

	session := &OpenCodeSession{baseURL: server.URL, sessionID: "s1", httpClient: server.Client()}
	schema := map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}}
	if err := session.SetNextOutputSchema(schema); err != nil {
		t.Fatal(err)
	}
	for turn := 0; turn < 2; turn++ {
		if err := session.Prompt(context.Background(), "hello", nil); err != nil {
			t.Fatal(err)
		}
		select {
		case body := <-bodies:
			format, has := body["format"].(map[string]any)
			if turn == 0 && (!has || format["type"] != "json_schema" || !reflect.DeepEqual(format["schema"], schema)) {
				t.Fatalf("first prompt body = %v", body)
			}
			if turn == 1 && has {
				t.Fatalf("the schema leaked into the next prompt: %v", body)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("no prompt reached the server")
		}
		_ = session.WaitForFinish(context.Background())
	}
}
