package terminal

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
)

// File-transfer frame codec, ported from @bytetrue/protocol/binary-frames/file-transfer.
//
// Large uploads and downloads travel as binary frames rather than JSON: a base64 blob inside a
// JSON message would be a third larger and would have to be built entirely in memory before
// anything could be written. The frames share the byte stream with terminal output, so they are
// discriminated by opcode.
const (
	OpcodeFileBegin Opcode = 0x10
	OpcodeFileChunk Opcode = 0x11
	OpcodeFileEnd   Opcode = 0x12
)

// FileBeginMetadata describes the upload that follows.
type FileBeginMetadata struct {
	Mime       string `json:"mime"`
	Size       int64  `json:"size"`
	Encoding   string `json:"encoding"` // "utf-8" | "binary"
	ModifiedAt string `json:"modifiedAt"`
	Revision   string `json:"revision,omitempty"`
	FileName   string `json:"fileName,omitempty"`
}

// FileFrame is one decoded transfer frame.
type FileFrame struct {
	Opcode    Opcode
	RequestID string
	Metadata  *FileBeginMetadata
	Payload   []byte
}

// DecodeFileFrame parses one frame.
//
// Layout (from encodeFileTransferFrame):
//
//	begin:  opcode | 1-byte id length | id | 2-byte metadata length | metadata JSON
//	chunk:  opcode | 1-byte id length | id | payload
//	end:    opcode | 1-byte id length | id
//
// A malformed frame returns an error rather than a partial result: a truncated chunk written to
// disk would corrupt the file, and the upload would then "succeed" with bad content.
func DecodeFileFrame(bytes []byte) (*FileFrame, error) {
	if len(bytes) < 2 {
		return nil, fmt.Errorf("file frame too short")
	}
	opcode := Opcode(bytes[0])
	idLen := int(bytes[1])
	if len(bytes) < 2+idLen {
		return nil, fmt.Errorf("file frame request id truncated")
	}
	requestID := string(bytes[2 : 2+idLen])
	rest := bytes[2+idLen:]

	switch opcode {
	case OpcodeFileBegin:
		if len(rest) < 2 {
			return nil, fmt.Errorf("file begin frame missing metadata length")
		}
		metaLen := int(binary.BigEndian.Uint16(rest[:2]))
		if len(rest) < 2+metaLen {
			return nil, fmt.Errorf("file begin frame metadata truncated")
		}
		var metadata FileBeginMetadata
		if err := json.Unmarshal(rest[2:2+metaLen], &metadata); err != nil {
			return nil, fmt.Errorf("file begin metadata is not valid JSON: %w", err)
		}
		return &FileFrame{Opcode: opcode, RequestID: requestID, Metadata: &metadata}, nil

	case OpcodeFileChunk:
		payload := make([]byte, len(rest))
		copy(payload, rest)
		return &FileFrame{Opcode: opcode, RequestID: requestID, Payload: payload}, nil

	case OpcodeFileEnd:
		return &FileFrame{Opcode: opcode, RequestID: requestID}, nil

	default:
		return nil, fmt.Errorf("not a file transfer frame: opcode 0x%02x", opcode)
	}
}

// EncodeFileBegin builds a begin frame.
func EncodeFileBegin(requestID string, metadata FileBeginMetadata) ([]byte, error) {
	if len(requestID) > 255 {
		return nil, fmt.Errorf("request id too long")
	}
	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	if len(metaJSON) > 0xffff {
		return nil, fmt.Errorf("file begin metadata is too long")
	}
	out := make([]byte, 0, 4+len(requestID)+len(metaJSON))
	out = append(out, byte(OpcodeFileBegin), byte(len(requestID)))
	out = append(out, requestID...)
	var length [2]byte
	binary.BigEndian.PutUint16(length[:], uint16(len(metaJSON)))
	out = append(out, length[:]...)
	out = append(out, metaJSON...)
	return out, nil
}

// EncodeFileChunk builds a chunk frame.
func EncodeFileChunk(requestID string, payload []byte) ([]byte, error) {
	if len(requestID) > 255 {
		return nil, fmt.Errorf("request id too long")
	}
	out := make([]byte, 0, 2+len(requestID)+len(payload))
	out = append(out, byte(OpcodeFileChunk), byte(len(requestID)))
	out = append(out, requestID...)
	out = append(out, payload...)
	return out, nil
}

// EncodeFileEnd builds an end frame.
func EncodeFileEnd(requestID string) ([]byte, error) {
	if len(requestID) > 255 {
		return nil, fmt.Errorf("request id too long")
	}
	out := make([]byte, 0, 2+len(requestID))
	out = append(out, byte(OpcodeFileEnd), byte(len(requestID)))
	out = append(out, requestID...)
	return out, nil
}

// IsFileTransferOpcode reports whether a binary frame belongs to the file-transfer family.
func IsFileTransferOpcode(op Opcode) bool {
	return op >= OpcodeFileBegin && op <= OpcodeFileEnd
}
