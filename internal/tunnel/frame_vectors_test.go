package tunnel

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// The wire layout is shared with the TS codec in packages/protocol/src/binary-frames/tunnel.ts.
// These vectors live in one JSON file both sides read, so a layout change in either codec that the
// other does not follow fails here and in tunnel-vectors.test.ts. frameHex is derived from the
// layout spec, not from either codec's output. Only the three opcodes TS decodes are covered.
type tunnelVectors struct {
	Valid []struct {
		Name       string `json:"name"`
		Opcode     int    `json:"opcode"`
		TunnelID   string `json:"tunnelId"`
		PayloadHex string `json:"payloadHex"`
		FrameHex   string `json:"frameHex"`
	} `json:"valid"`
	Invalid []struct {
		Name     string `json:"name"`
		FrameHex string `json:"frameHex"`
	} `json:"invalid"`
}

func loadTunnelVectors(t *testing.T) tunnelVectors {
	t.Helper()
	raw, err := os.ReadFile("../../packages/protocol/src/binary-frames/tunnel-vectors.json")
	if err != nil {
		t.Fatalf("read shared vectors: %v", err)
	}
	var vectors tunnelVectors
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("parse shared vectors: %v", err)
	}
	if len(vectors.Valid) == 0 || len(vectors.Invalid) == 0 {
		t.Fatal("shared vectors file is empty")
	}
	return vectors
}

func TestTunnelFrameVectorsDecode(t *testing.T) {
	for _, v := range loadTunnelVectors(t).Valid {
		t.Run(v.Name, func(t *testing.T) {
			frameBytes, err := hex.DecodeString(v.FrameHex)
			if err != nil {
				t.Fatalf("bad frameHex: %v", err)
			}
			payload, err := hex.DecodeString(v.PayloadHex)
			if err != nil {
				t.Fatalf("bad payloadHex: %v", err)
			}
			frame, ok := DecodeFrame(frameBytes)
			if !ok {
				t.Fatalf("DecodeFrame rejected a valid vector")
			}
			if int(frame.Opcode) != v.Opcode {
				t.Fatalf("opcode = %#x, want %#x", frame.Opcode, v.Opcode)
			}
			if frame.TunnelID != v.TunnelID {
				t.Fatalf("tunnelId = %q, want %q", frame.TunnelID, v.TunnelID)
			}
			if !bytes.Equal(frame.Payload, payload) {
				t.Fatalf("payload = %x, want %x", frame.Payload, payload)
			}
		})
	}
}

func TestTunnelFrameVectorsEncode(t *testing.T) {
	for _, v := range loadTunnelVectors(t).Valid {
		t.Run(v.Name, func(t *testing.T) {
			payload, err := hex.DecodeString(v.PayloadHex)
			if err != nil {
				t.Fatalf("bad payloadHex: %v", err)
			}
			got, err := EncodeFrame(byte(v.Opcode), v.TunnelID, payload)
			if err != nil {
				t.Fatalf("EncodeFrame: %v", err)
			}
			if hex.EncodeToString(got) != v.FrameHex {
				t.Fatalf("encoded %x, want %s", got, v.FrameHex)
			}
		})
	}
}

func TestTunnelFrameVectorsRejectInvalid(t *testing.T) {
	for _, v := range loadTunnelVectors(t).Invalid {
		t.Run(v.Name, func(t *testing.T) {
			frameBytes, err := hex.DecodeString(v.FrameHex)
			if err != nil {
				t.Fatalf("bad frameHex: %v", err)
			}
			if _, ok := DecodeFrame(frameBytes); ok {
				t.Fatalf("DecodeFrame accepted invalid vector %s", v.Name)
			}
		})
	}
}
