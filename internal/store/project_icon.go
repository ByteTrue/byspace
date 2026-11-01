package store

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/workspace/projecticon"
)

// Custom project icons, ported from Node's utils/project-custom-icon.ts. The client owns image
// acquisition (file picker, URL import); the daemon accepts bytes, validates them, and records a
// new revision on the project. The revision is what lets clients cache an icon per project and tell
// a custom icon from the automatic one — without it the edit sheet never offered "Use automatic"
// and the sidebar kept the icon it had cached before the change.

const (
	maxCustomIconBytes  = 512 * 1024
	customIconTooLarge  = "Icon must be 512 KB or smaller"
	customIconBadFormat = "Unsupported or invalid icon file"
	customIconNotSquare = "Icon must be a square image up to 1024×1024"
)

// ErrProjectNotFound is a request for a project the registry does not have.
var ErrProjectNotFound = errors.New("Project not found")

// ProjectIconSnapshot is the icon a project renders with and a revision naming those exact bytes.
type ProjectIconSnapshot struct {
	Icon     *projecticon.Icon
	Revision string
}

func (s *Store) customIconPath(projectID string) string {
	sum := sha256.Sum256([]byte(projectID))
	return filepath.Join(s.homeDir, "projects", "icons", hex.EncodeToString(sum[:])+".bin")
}

// SetProjectCustomIcon stores an uploaded icon (base64 `data`) or, for automatic, removes the custom
// one, and records the new revision on the project. Returns the updated record.
func (s *Store) SetProjectCustomIcon(projectID string, automatic bool, data string) (ProjectRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	projects, err := readJSONArray[ProjectRecord](s.projectsPath())
	if err != nil {
		return ProjectRecord{}, err
	}
	index := -1
	for i := range projects {
		if projects[i].ProjectID == projectID {
			index = i
			break
		}
	}
	if index == -1 {
		return ProjectRecord{}, ErrProjectNotFound
	}

	var revision *string
	if automatic {
		if err := os.Remove(s.customIconPath(projectID)); err != nil && !os.IsNotExist(err) {
			return ProjectRecord{}, err
		}
	} else {
		raw, decodeErr := base64.StdEncoding.DecodeString(data)
		if decodeErr != nil {
			return ProjectRecord{}, errors.New(customIconBadFormat)
		}
		if _, err := validateCustomIcon(raw); err != nil {
			return ProjectRecord{}, err
		}
		if err := home.WriteAtomic(s.customIconPath(projectID), raw, 0o600); err != nil {
			return ProjectRecord{}, err
		}
		next := newRevision()
		revision = &next
	}

	projects[index].CustomIconRevision = revision
	projects[index].UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := writeJSONArray(s.projectsPath(), projects); err != nil {
		return ProjectRecord{}, err
	}
	return projects[index], nil
}

// RemoveProjectCustomIcon deletes a project's custom icon bytes and clears its revision, as Node
// does when the project is removed.
func (s *Store) RemoveProjectCustomIcon(projectID string) error {
	_, err := s.SetProjectCustomIcon(projectID, true, "")
	return err
}

// ProjectIconSnapshot resolves the icon a project renders with, custom or automatic, and gives that
// exact result a stable identity (Node's readProjectIconSnapshot).
func (s *Store) ProjectIconSnapshot(project ProjectRecord) ProjectIconSnapshot {
	if project.CustomIconRevision != nil && *project.CustomIconRevision != "" {
		if raw, err := os.ReadFile(s.customIconPath(project.ProjectID)); err == nil {
			if icon, err := validateCustomIcon(raw); err == nil {
				return ProjectIconSnapshot{Icon: icon, Revision: iconRevision("custom", icon)}
			}
		}
		// A missing or corrupt custom icon is itself a cacheable result until the revision changes.
		return ProjectIconSnapshot{Revision: "custom:none:" + *project.CustomIconRevision}
	}
	icon := projecticon.Get(project.RootPath)
	if icon == nil {
		return ProjectIconSnapshot{Revision: "automatic:none:v1"}
	}
	return ProjectIconSnapshot{Icon: icon, Revision: iconRevision("automatic", icon)}
}

func iconRevision(source string, icon *projecticon.Icon) string {
	sum := sha256.New()
	sum.Write([]byte(icon.MimeType))
	sum.Write([]byte{0})
	sum.Write([]byte(icon.Data))
	return source + ":" + hex.EncodeToString(sum.Sum(nil))
}

func newRevision() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

var customIconPNGSignature = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

// customIconMimeType is project-custom-icon.ts's detectMimeType: stricter than the automatic
// search's sniffing (full GIF header, a whole ICO directory entry).
func customIconMimeType(b []byte) string {
	switch {
	case len(b) >= 8 && bytes.Equal(b[:8], customIconPNGSignature):
		return "image/png"
	case len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "image/jpeg"
	case len(b) >= 6 && (string(b[:6]) == "GIF87a" || string(b[:6]) == "GIF89a"):
		return "image/gif"
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	case len(b) >= 22 && binary.LittleEndian.Uint16(b[0:]) == 0 && binary.LittleEndian.Uint16(b[2:]) == 1 && binary.LittleEndian.Uint16(b[4:]) > 0:
		return "image/x-icon"
	}
	return ""
}

func validateCustomIcon(raw []byte) (*projecticon.Icon, error) {
	if len(raw) == 0 || len(raw) > maxCustomIconBytes {
		return nil, errors.New(customIconTooLarge)
	}
	mimeType := customIconMimeType(raw)
	if mimeType == "" {
		return nil, errors.New(customIconBadFormat)
	}
	width, height, ok := projecticon.ImageDimensions(raw, mimeType)
	if !ok || width <= 0 || width != height || width > 1024 {
		return nil, errors.New(customIconNotSquare)
	}
	return &projecticon.Icon{Data: base64.StdEncoding.EncodeToString(raw), MimeType: mimeType}, nil
}
