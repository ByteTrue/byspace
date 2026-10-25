// Package tunnel forwards TCP ports from one daemon to another over the relay.
//
// Ported from tunnel-manager.ts / tunnel-registry.ts / session/tunnel/tunnel-session.ts.
//
// The feature itself predates the Go rewrite: issue 062 delivered it and verified it across two
// machines (Windows as the initiator, WSL as the target, public Cloudflare relay). This package
// is the transport, not a new design.
package tunnel

import (
	"errors"
	"fmt"
)

// Frame opcodes, allocated after the file-transfer block in protocol/src/binary-frames/tunnel.ts.
const (
	// OpcodeDataUpstream carries stream bytes from the initiator to the target host.
	OpcodeDataUpstream byte = 0x20
	// OpcodeDataDownstream carries stream bytes from the target host back to the initiator.
	OpcodeDataDownstream byte = 0x21
	// OpcodeClose tears one tunnel stream down.
	OpcodeClose byte = 0x22
)

// MaxTunnelIDLength bounds the stream id. The wire format stores its length in one byte.
const MaxTunnelIDLength = 255

// Frame is one tunnel message.
//
// Layout on the wire is `opcode | idLen | id | payload`, matching the TypeScript codec byte for
// byte: a Go daemon and a TypeScript client must interoperate, so the layout is not free to change.
type Frame struct {
	Opcode   byte
	TunnelID string
	Payload  []byte
}

// EncodeFrame serialises a frame.
func EncodeFrame(opcode byte, tunnelID string, payload []byte) ([]byte, error) {
	if len(tunnelID) == 0 {
		return nil, errors.New("tunnel id is required")
	}
	if len(tunnelID) > MaxTunnelIDLength {
		return nil, fmt.Errorf("tunnel id is %d bytes, max %d", len(tunnelID), MaxTunnelIDLength)
	}
	out := make([]byte, 2+len(tunnelID)+len(payload))
	out[0] = opcode
	out[1] = byte(len(tunnelID))
	copy(out[2:], tunnelID)
	copy(out[2+len(tunnelID):], payload)
	return out, nil
}

// DecodeFrame parses a frame, returning false for anything that is not a tunnel frame.
//
// `ok` rather than an error for the invalid case: the demultiplexer tries each opcode family in
// turn, and "this is a terminal frame" is not a failure there.
func DecodeFrame(data []byte) (Frame, bool) {
	if len(data) < 2 {
		return Frame{}, false
	}
	opcode := data[0]
	if opcode != OpcodeDataUpstream && opcode != OpcodeDataDownstream && opcode != OpcodeClose {
		return Frame{}, false
	}
	idLen := int(data[1])
	if idLen == 0 || len(data) < 2+idLen {
		return Frame{}, false
	}
	frame := Frame{
		Opcode:   opcode,
		TunnelID: string(data[2 : 2+idLen]),
	}
	if len(data) > 2+idLen {
		// Copy: the caller's buffer is reused by the websocket reader.
		frame.Payload = append([]byte(nil), data[2+idLen:]...)
	}
	return frame, true
}

// IsTunnelOpcode reports whether a first byte belongs to the tunnel family.
//
// The demultiplexer needs this before trying the other families: tunnel opcodes sit above the
// terminal and file-transfer ranges, so a tunnel frame offered to the terminal decoder is rejected
// as a bad slot and the bytes are dropped without a trace.
func IsTunnelOpcode(opcode byte) bool {
	return opcode == OpcodeDataUpstream || opcode == OpcodeDataDownstream || opcode == OpcodeClose
}
