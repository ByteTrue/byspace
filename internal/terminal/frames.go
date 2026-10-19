package terminal

import (
	"encoding/json"
	"errors"
)

type Opcode byte

const (
	OpcodeOutput   Opcode = 0x01
	OpcodeInput    Opcode = 0x02
	OpcodeResize   Opcode = 0x03
	OpcodeSnapshot Opcode = 0x04
	OpcodeRestore  Opcode = 0x05
)

type StreamFrame struct {
	Opcode  Opcode
	Slot    uint8
	Payload []byte
}

type ResizePayload struct {
	Rows   int    `json:"rows"`
	Cols   int    `json:"cols"`
	Intent string `json:"intent,omitempty"`
}

func isValidOpcode(op Opcode) bool {
	switch op {
	case OpcodeOutput, OpcodeInput, OpcodeResize, OpcodeSnapshot, OpcodeRestore:
		return true
	default:
		return false
	}
}

// EncodeFrame encodes a terminal binary frame: [opcode:1][slot:1][payload...].
func EncodeFrame(op Opcode, slot uint8, payload []byte) []byte {
	out := make([]byte, 2+len(payload))
	out[0] = byte(op)
	out[1] = slot
	copy(out[2:], payload)
	return out
}

// DecodeFrame decodes a terminal binary frame.
func DecodeFrame(raw []byte) (StreamFrame, error) {
	if len(raw) < 2 {
		return StreamFrame{}, errors.New("terminal frame too short")
	}
	op := Opcode(raw[0])
	if !isValidOpcode(op) {
		return StreamFrame{}, errors.New("unknown terminal frame opcode")
	}
	return StreamFrame{
		Opcode:  op,
		Slot:    raw[1],
		Payload: raw[2:],
	}, nil
}

// EncodeResizePayload encodes ResizePayload as JSON bytes.
func EncodeResizePayload(r ResizePayload) ([]byte, error) {
	return json.Marshal(r)
}

// DecodeResizePayload decodes ResizePayload from JSON bytes.
func DecodeResizePayload(raw []byte) (ResizePayload, error) {
	var r ResizePayload
	if err := json.Unmarshal(raw, &r); err != nil {
		return ResizePayload{}, err
	}
	if r.Rows <= 0 || r.Cols <= 0 {
		return ResizePayload{}, errors.New("invalid terminal resize dimensions")
	}
	return r, nil
}
