package protocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestClientJSONFixtures(t *testing.T) {
	for _, path := range fixtureFiles(t, "valid", "client-to-daemon") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			wire := readFixture(t, path)
			frame, err := DecodeClientFrame(wire)
			if err != nil {
				t.Fatalf("DecodeClientFrame: %v", err)
			}
			encoded, err := json.Marshal(frame)
			if err != nil {
				t.Fatalf("encode client frame: %v", err)
			}
			assertJSONEqual(t, wire, encoded)
		})
	}
}

func TestCompatibleClientJSONFixtures(t *testing.T) {
	for _, path := range fixtureFiles(t, "compat", "client-to-daemon") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			frame, err := DecodeClientFrame(readFixture(t, path))
			if err != nil {
				t.Fatalf("DecodeClientFrame: %v", err)
			}
			encoded, err := json.Marshal(frame)
			if err != nil {
				t.Fatalf("encode client frame: %v", err)
			}
			if bytes.Contains(encoded, []byte("futureMessageField")) || bytes.Contains(encoded, []byte("futureEnvelopeField")) {
				t.Fatalf("unknown fields leaked into canonical output: %s", encoded)
			}
			if !bytes.Contains(encoded, []byte("Known data survives.")) {
				t.Fatalf("known field was lost: %s", encoded)
			}
		})
	}
}

func TestInvalidClientJSONFixtures(t *testing.T) {
	for _, path := range fixtureFiles(t, "invalid", "client-to-daemon") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			if _, err := DecodeClientFrame(readFixture(t, path)); err == nil {
				t.Fatal("DecodeClientFrame unexpectedly accepted invalid fixture")
			}
		})
	}
}

func TestServerJSONFixtures(t *testing.T) {
	for _, path := range fixtureFiles(t, "valid", "daemon-to-client") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			wire := readFixture(t, path)
			encoded, err := encodeServerFixture(wire)
			if err != nil {
				t.Fatalf("encode server fixture: %v", err)
			}
			assertJSONEqual(t, wire, encoded)
		})
	}
}

func TestCompatibleServerJSONFixtures(t *testing.T) {
	for _, path := range fixtureFiles(t, "compat", "daemon-to-client") {
		t.Run(filepath.Base(path), func(t *testing.T) {
			encoded, err := encodeServerFixture(readFixture(t, path))
			if err != nil {
				t.Fatalf("encode server fixture: %v", err)
			}
			if bytes.Contains(encoded, []byte("futureServerField")) {
				t.Fatalf("unknown field leaked into canonical output: %s", encoded)
			}
			if !bytes.Contains(encoded, []byte("server-fixture-1")) {
				t.Fatalf("known field was lost: %s", encoded)
			}
		})
	}
}

func TestBinaryFixtures(t *testing.T) {
	var fixtures struct {
		Valid   []binaryFixture `json:"valid"`
		Invalid []binaryFixture `json:"invalid"`
	}
	if err := json.Unmarshal(readFixture(t, filepath.Join(fixtureRoot(), "binary.json")), &fixtures); err != nil {
		t.Fatalf("decode binary fixtures: %v", err)
	}

	for _, fixture := range fixtures.Valid {
		t.Run(fixture.Name, func(t *testing.T) {
			want := decodeHex(t, fixture.WireHex)
			frame := frameFromFixture(t, fixture)
			got, err := EncodeBinaryFrame(frame)
			if err != nil {
				t.Fatalf("EncodeBinaryFrame: %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("wire mismatch\nwant %x\n got %x", want, got)
			}

			decoded, err := DecodeBinaryFrame(want)
			if err != nil {
				t.Fatalf("DecodeBinaryFrame: %v", err)
			}
			roundTrip, err := EncodeBinaryFrame(decoded)
			if err != nil {
				t.Fatalf("re-encode binary frame: %v", err)
			}
			if !bytes.Equal(roundTrip, want) {
				t.Fatalf("round-trip mismatch\nwant %x\n got %x", want, roundTrip)
			}

			if fixture.Kind == "terminal_resize" {
				terminal := decoded.(*TerminalFrame)
				resize, err := DecodeTerminalResizePayload(terminal.Payload)
				if err != nil {
					t.Fatalf("DecodeTerminalResizePayload: %v", err)
				}
				if resize != fixture.Resize {
					t.Fatalf("resize mismatch: want %+v, got %+v", fixture.Resize, resize)
				}
			}
		})
	}

	for _, fixture := range fixtures.Invalid {
		t.Run("invalid/"+fixture.Name, func(t *testing.T) {
			if _, err := DecodeBinaryFrame(decodeHex(t, fixture.WireHex)); err == nil {
				t.Fatal("DecodeBinaryFrame unexpectedly accepted invalid fixture")
			}
		})
	}
}

type binaryFixture struct {
	Name       string                `json:"name"`
	Kind       string                `json:"kind"`
	Opcode     string                `json:"opcode"`
	Slot       byte                  `json:"slot"`
	PayloadHex string                `json:"payloadHex"`
	WireHex    string                `json:"wireHex"`
	Resize     TerminalResizePayload `json:"resize"`
	RequestID  string                `json:"requestId"`
	Metadata   FileBeginMetadata     `json:"metadata"`
}

func frameFromFixture(t *testing.T, fixture binaryFixture) BinaryFrame {
	t.Helper()
	switch fixture.Kind {
	case "terminal":
		if fixture.Opcode != "output" {
			t.Fatalf("unsupported terminal fixture opcode %q", fixture.Opcode)
		}
		return &TerminalFrame{Opcode: TerminalOutput, Slot: fixture.Slot, Payload: decodeHex(t, fixture.PayloadHex)}
	case "terminal_resize":
		payload, err := EncodeTerminalResizePayload(fixture.Resize)
		if err != nil {
			t.Fatalf("EncodeTerminalResizePayload: %v", err)
		}
		return &TerminalFrame{Opcode: TerminalResize, Slot: fixture.Slot, Payload: payload}
	case "file_begin":
		return &FileTransferFrame{Opcode: FileBegin, RequestID: fixture.RequestID, Metadata: &fixture.Metadata}
	case "file_chunk":
		return &FileTransferFrame{Opcode: FileChunk, RequestID: fixture.RequestID, Payload: decodeHex(t, fixture.PayloadHex)}
	case "file_end":
		return &FileTransferFrame{Opcode: FileEnd, RequestID: fixture.RequestID}
	default:
		t.Fatalf("unsupported binary fixture kind %q", fixture.Kind)
		return nil
	}
}

func encodeServerFixture(data []byte) ([]byte, error) {
	var frame struct {
		Type    string `json:"type"`
		Message struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		} `json:"message"`
	}
	if err := json.Unmarshal(data, &frame); err != nil {
		return nil, err
	}
	if frame.Type == "pong" {
		return EncodePong(), nil
	}
	if frame.Type != "session" {
		return nil, fmt.Errorf("unsupported server frame type %q", frame.Type)
	}

	var message ServerMessage
	switch frame.Message.Type {
	case "status":
		var status struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(frame.Message.Payload, &status); err != nil {
			return nil, err
		}
		switch status.Status {
		case "server_info":
			message = new(ServerInfo)
		case "agent_created":
			message = new(AgentCreated)
		default:
			return nil, fmt.Errorf("unsupported status %q", status.Status)
		}
	case "fetch_agents_response":
		message = new(FetchAgentsResponse)
	case "fetch_agent_timeline_response":
		message = new(FetchAgentTimelineResponse)
	case "send_agent_message_response":
		message = new(SendAgentMessageResponse)
	case "agent_stream":
		message = new(AgentStream)
	default:
		return nil, fmt.Errorf("unsupported server message type %q", frame.Message.Type)
	}
	if err := json.Unmarshal(frame.Message.Payload, message); err != nil {
		return nil, err
	}
	return EncodeServerMessage(message)
}

func fixtureRoot() string {
	return filepath.Join("..", "..", "..", "fixtures", "protocol", "v1")
}

func fixtureFiles(t *testing.T, parts ...string) []string {
	t.Helper()
	pattern := filepath.Join(append([]string{fixtureRoot()}, parts...)...)
	files, err := filepath.Glob(filepath.Join(pattern, "*.json"))
	if err != nil {
		t.Fatalf("glob fixtures: %v", err)
	}
	if len(files) == 0 {
		t.Fatalf("no fixtures found under %s", pattern)
	}
	return files
}

func readFixture(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	return data
}

func decodeHex(t *testing.T, value string) []byte {
	t.Helper()
	data, err := hex.DecodeString(value)
	if err != nil {
		t.Fatalf("decode hex %q: %v", value, err)
	}
	return data
}

func assertJSONEqual(t *testing.T, want, got []byte) {
	t.Helper()
	var wantValue, gotValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode expected JSON: %v", err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode actual JSON: %v", err)
	}
	if !reflect.DeepEqual(wantValue, gotValue) {
		t.Fatalf("JSON mismatch\nwant %s\n got %s", strings.TrimSpace(string(want)), strings.TrimSpace(string(got)))
	}
}
