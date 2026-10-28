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
	// OpcodeOpen asks the target to dial one of its ports and start a stream.
	//
	// The node daemon did this with a `tunnel.open.request` JSON message and awaited
	// `tunnel.open.response` before sending bytes. Keeping it on the binary channel instead means the
	// handshake cannot be reordered against the data it gates: both travel on the same socket, so a
	// `DataUpstream` can never overtake its own `Open`.
	//
	// Payload: 2-byte big-endian remote port.
	OpcodeOpen byte = 0x1f
	// OpcodeOpenAck answers an open: one status byte, then a UTF-8 reason when it is not 0.
	OpcodeOpenAck byte = 0x23
	// OpcodeDataUpstream carries stream bytes from the initiator to the target host.
	OpcodeDataUpstream byte = 0x20
	// OpcodeDataDownstream carries stream bytes from the target host back to the initiator.
	OpcodeDataDownstream byte = 0x21
	// OpcodeClose tears one tunnel stream down.
	OpcodeClose byte = 0x22
)

// Open acknowledgement status bytes.
const (
	// OpenAllowed means the target dialled the port and the stream is live.
	OpenAllowed byte = 0
	// OpenDenied means the target refused, for the reason carried after the byte.
	OpenDenied byte = 1
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
	switch opcode {
	case OpcodeOpen, OpcodeOpenAck, OpcodeDataUpstream, OpcodeDataDownstream, OpcodeClose:
	default:
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
	switch opcode {
	case OpcodeOpen, OpcodeOpenAck, OpcodeDataUpstream, OpcodeDataDownstream, OpcodeClose:
		return true
	default:
		return false
	}
}

// EncodeOpenPayload writes the port an open request asks for.
func EncodeOpenPayload(remotePort int) []byte {
	return []byte{byte(remotePort >> 8), byte(remotePort)}
}

// DecodeOpenPayload reads that port back.
func DecodeOpenPayload(payload []byte) (int, bool) {
	if len(payload) < 2 {
		return 0, false
	}
	port := int(payload[0])<<8 | int(payload[1])
	if port < 1 || port > 65535 {
		return 0, false
	}
	return port, true
}

// EncodeOpenAck writes an acknowledgement: status byte, then the denial reason.
func EncodeOpenAck(allowed bool, reason string) []byte {
	if allowed {
		return []byte{OpenAllowed}
	}
	out := make([]byte, 1+len(reason))
	out[0] = OpenDenied
	copy(out[1:], reason)
	return out
}

// DecodeOpenAck reads an acknowledgement.
func DecodeOpenAck(payload []byte) (allowed bool, reason string, ok bool) {
	if len(payload) < 1 {
		return false, "", false
	}
	switch payload[0] {
	case OpenAllowed:
		return true, "", true
	case OpenDenied:
		return false, string(payload[1:]), true
	default:
		return false, "", false
	}
}
