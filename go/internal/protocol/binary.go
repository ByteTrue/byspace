package protocol

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
)

const (
	TerminalOutput   byte = 0x01
	TerminalInput    byte = 0x02
	TerminalResize   byte = 0x03
	TerminalSnapshot byte = 0x04
	TerminalRestore  byte = 0x05

	FileBegin byte = 0x10
	FileChunk byte = 0x11
	FileEnd   byte = 0x12
)

type BinaryFrame interface {
	binaryFrame()
}

type TerminalFrame struct {
	Opcode  byte
	Slot    byte
	Payload []byte
}

func (*TerminalFrame) binaryFrame() {}

type FileBeginMetadata struct {
	MIME       string  `json:"mime"`
	Size       int64   `json:"size"`
	Encoding   string  `json:"encoding"`
	ModifiedAt string  `json:"modifiedAt"`
	Revision   *string `json:"revision,omitempty"`
	FileName   *string `json:"fileName,omitempty"`
}

type FileTransferFrame struct {
	Opcode    byte
	RequestID string
	Metadata  *FileBeginMetadata
	Payload   []byte
}

func (*FileTransferFrame) binaryFrame() {}

type TerminalResizePayload struct {
	Rows   int    `json:"rows"`
	Cols   int    `json:"cols"`
	Intent string `json:"intent,omitempty"`
}

func EncodeBinaryFrame(frame BinaryFrame) ([]byte, error) {
	switch value := frame.(type) {
	case *TerminalFrame:
		return encodeTerminalFrame(value)
	case *FileTransferFrame:
		return encodeFileTransferFrame(value)
	default:
		return nil, errors.New("protocol: unsupported binary frame")
	}
}

func DecodeBinaryFrame(data []byte) (BinaryFrame, error) {
	if len(data) == 0 {
		return nil, errors.New("protocol: empty binary frame")
	}
	switch data[0] {
	case TerminalOutput, TerminalInput, TerminalResize, TerminalSnapshot, TerminalRestore:
		return decodeTerminalFrame(data)
	case FileBegin, FileChunk, FileEnd:
		return decodeFileTransferFrame(data)
	default:
		return nil, fmt.Errorf("protocol: unsupported binary opcode 0x%02x", data[0])
	}
}

func EncodeTerminalResizePayload(payload TerminalResizePayload) ([]byte, error) {
	if err := validateTerminalResizePayload(payload); err != nil {
		return nil, err
	}
	return json.Marshal(payload)
}

func DecodeTerminalResizePayload(data []byte) (TerminalResizePayload, error) {
	var payload TerminalResizePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return TerminalResizePayload{}, fmt.Errorf("protocol: decode terminal resize: %w", err)
	}
	if err := validateTerminalResizePayload(payload); err != nil {
		return TerminalResizePayload{}, err
	}
	return payload, nil
}

func validateTerminalResizePayload(payload TerminalResizePayload) error {
	if payload.Rows <= 0 || payload.Cols <= 0 {
		return errors.New("protocol: terminal resize rows and cols must be positive")
	}
	if payload.Intent != "" && payload.Intent != "claim" && payload.Intent != "update" {
		return fmt.Errorf("protocol: invalid terminal resize intent %q", payload.Intent)
	}
	return nil
}

func encodeTerminalFrame(frame *TerminalFrame) ([]byte, error) {
	if frame == nil || !isTerminalOpcode(frame.Opcode) {
		return nil, errors.New("protocol: invalid terminal frame")
	}
	wire := make([]byte, 2+len(frame.Payload))
	wire[0] = frame.Opcode
	wire[1] = frame.Slot
	copy(wire[2:], frame.Payload)
	return wire, nil
}

func decodeTerminalFrame(data []byte) (*TerminalFrame, error) {
	if len(data) < 2 {
		return nil, errors.New("protocol: terminal frame is missing slot")
	}
	if !isTerminalOpcode(data[0]) {
		return nil, errors.New("protocol: invalid terminal opcode")
	}
	return &TerminalFrame{
		Opcode:  data[0],
		Slot:    data[1],
		Payload: append([]byte(nil), data[2:]...),
	}, nil
}

func isTerminalOpcode(opcode byte) bool {
	return opcode >= TerminalOutput && opcode <= TerminalRestore
}

func encodeFileTransferFrame(frame *FileTransferFrame) ([]byte, error) {
	if frame == nil || !isFileOpcode(frame.Opcode) {
		return nil, errors.New("protocol: invalid file transfer frame")
	}
	requestID := []byte(frame.RequestID)
	if len(requestID) == 0 {
		return nil, errors.New("protocol: file transfer requestId is required")
	}
	if len(requestID) > 0xff {
		return nil, errors.New("protocol: file transfer requestId is too long")
	}

	switch frame.Opcode {
	case FileBegin:
		if frame.Metadata == nil {
			return nil, errors.New("protocol: file begin metadata is required")
		}
		if err := validateFileMetadata(*frame.Metadata); err != nil {
			return nil, err
		}
		metadata, err := json.Marshal(frame.Metadata)
		if err != nil {
			return nil, fmt.Errorf("protocol: encode file metadata: %w", err)
		}
		if len(metadata) > 0xffff {
			return nil, errors.New("protocol: file begin metadata is too long")
		}
		wire := make([]byte, 4+len(requestID)+len(metadata))
		wire[0] = FileBegin
		wire[1] = byte(len(requestID))
		copy(wire[2:], requestID)
		binary.BigEndian.PutUint16(wire[2+len(requestID):], uint16(len(metadata)))
		copy(wire[4+len(requestID):], metadata)
		return wire, nil
	case FileChunk:
		wire := make([]byte, 2+len(requestID)+len(frame.Payload))
		wire[0] = FileChunk
		wire[1] = byte(len(requestID))
		copy(wire[2:], requestID)
		copy(wire[2+len(requestID):], frame.Payload)
		return wire, nil
	case FileEnd:
		if len(frame.Payload) != 0 {
			return nil, errors.New("protocol: file end cannot contain payload")
		}
		wire := make([]byte, 2+len(requestID))
		wire[0] = FileEnd
		wire[1] = byte(len(requestID))
		copy(wire[2:], requestID)
		return wire, nil
	}
	return nil, errors.New("protocol: invalid file transfer frame")
}

func decodeFileTransferFrame(data []byte) (*FileTransferFrame, error) {
	if len(data) < 2 {
		return nil, errors.New("protocol: file transfer frame is truncated")
	}
	requestIDLength := int(data[1])
	if requestIDLength == 0 || requestIDLength > len(data)-2 {
		return nil, errors.New("protocol: invalid file transfer requestId length")
	}
	requestID := string(data[2 : 2+requestIDLength])
	body := data[2+requestIDLength:]

	switch data[0] {
	case FileBegin:
		if len(body) < 2 {
			return nil, errors.New("protocol: file begin metadata length is missing")
		}
		metadataLength := int(binary.BigEndian.Uint16(body[:2]))
		if metadataLength != len(body)-2 {
			return nil, errors.New("protocol: file begin metadata length mismatch")
		}
		metadataObject, err := decodeObject(body[2:])
		if err != nil {
			return nil, fmt.Errorf("protocol: file begin metadata: %w", err)
		}
		for _, field := range []string{"mime", "encoding", "modifiedAt"} {
			if _, err := requiredString(metadataObject, field); err != nil {
				return nil, fmt.Errorf("protocol: file begin metadata: %w", err)
			}
		}
		if _, ok := metadataObject["size"]; !ok {
			return nil, errors.New("protocol: file begin metadata: missing size")
		}
		var metadata FileBeginMetadata
		if err := json.Unmarshal(body[2:], &metadata); err != nil {
			return nil, fmt.Errorf("protocol: decode file begin metadata: %w", err)
		}
		if err := validateFileMetadata(metadata); err != nil {
			return nil, err
		}
		return &FileTransferFrame{Opcode: FileBegin, RequestID: requestID, Metadata: &metadata}, nil
	case FileChunk:
		return &FileTransferFrame{
			Opcode:    FileChunk,
			RequestID: requestID,
			Payload:   append([]byte(nil), body...),
		}, nil
	case FileEnd:
		if len(body) != 0 {
			return nil, errors.New("protocol: file end has trailing payload")
		}
		return &FileTransferFrame{Opcode: FileEnd, RequestID: requestID}, nil
	default:
		return nil, errors.New("protocol: invalid file transfer opcode")
	}
}

func validateFileMetadata(metadata FileBeginMetadata) error {
	if metadata.MIME == "" {
		return errors.New("protocol: file metadata mime is required")
	}
	if metadata.Size < 0 {
		return errors.New("protocol: file metadata size must not be negative")
	}
	if metadata.Encoding != "utf-8" && metadata.Encoding != "binary" {
		return fmt.Errorf("protocol: invalid file metadata encoding %q", metadata.Encoding)
	}
	return nil
}

func isFileOpcode(opcode byte) bool {
	return opcode == FileBegin || opcode == FileChunk || opcode == FileEnd
}
