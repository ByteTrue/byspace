package diff

import (
	"encoding/binary"
	"encoding/json"
	"fmt"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// Diff frames carry one revision of a comparison. Begin and End are JSON control frames, schema-
// checked on the client like every other daemon message; Bodies is binary so file text is never
// escaped or base64'd. Layouts are design.md D10 in the event-driven observation change.
const (
	OpcodeBegin  byte = 0x30
	OpcodeBodies byte = 0x31
	OpcodeEnd    byte = 0x32
)

type Resolved struct {
	BaseSha      string `json:"baseSha"`
	HeadSha      string `json:"headSha"`
	MergeBaseSha string `json:"mergeBaseSha"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type BeginHeader struct {
	Revision uint64         `json:"revision"`
	Cwd      string         `json:"cwd"`
	Compare  map[string]any `json:"compare"`
	Resolved Resolved       `json:"resolved"`
	Entries  []string       `json:"entries"`
	Error    *Error         `json:"error"`
}

type EndTrailer struct {
	Revision     uint64 `json:"revision"`
	Omitted      int    `json:"omitted"`
	DiffTooLarge bool   `json:"diffTooLarge"`
	Error        *Error `json:"error"`
}

// EncodeBegin writes [opcode][1B id length][id][JSON header].
func EncodeBegin(subscriptionID string, header BeginHeader) ([]byte, error) {
	return encodeControl(OpcodeBegin, subscriptionID, header)
}

// EncodeEnd writes [opcode][1B id length][id][JSON trailer].
func EncodeEnd(subscriptionID string, trailer EndTrailer) ([]byte, error) {
	return encodeControl(OpcodeEnd, subscriptionID, trailer)
}

func encodeControl(opcode byte, subscriptionID string, payload any) ([]byte, error) {
	id := []byte(subscriptionID)
	if len(id) == 0 || len(id) > 0xff {
		return nil, fmt.Errorf("diff: subscription id must be 1..255 bytes, got %d", len(id))
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 0, 2+len(id)+len(body))
	out = append(out, opcode, byte(len(id)))
	out = append(out, id...)
	return append(out, body...), nil
}

// EncodeBodies writes [opcode][1B id length][id][4B file count] then per file
// [2B path length][path][4B body length][body]. A body is the file's ParsedDiffFile as JSON, the
// same shape the JSON payload carries.
func EncodeBodies(subscriptionID string, files []workspace.ParsedDiffFile) ([]byte, error) {
	id := []byte(subscriptionID)
	if len(id) == 0 || len(id) > 0xff {
		return nil, fmt.Errorf("diff: subscription id must be 1..255 bytes, got %d", len(id))
	}
	out := make([]byte, 0, 2+len(id)+4)
	out = append(out, OpcodeBodies, byte(len(id)))
	out = append(out, id...)
	var count [4]byte
	binary.BigEndian.PutUint32(count[:], uint32(len(files)))
	out = append(out, count[:]...)
	for _, file := range files {
		path := []byte(file.Path)
		if len(path) > 0xffff {
			return nil, fmt.Errorf("diff: path %q is too long", file.Path)
		}
		body, err := json.Marshal(file)
		if err != nil {
			return nil, err
		}
		var sizes [2]byte
		binary.BigEndian.PutUint16(sizes[:], uint16(len(path)))
		out = append(out, sizes[:]...)
		out = append(out, path...)
		binary.BigEndian.PutUint32(count[:], uint32(len(body)))
		out = append(out, count[:]...)
		out = append(out, body...)
	}
	return out, nil
}
