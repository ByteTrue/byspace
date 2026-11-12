package tunnel

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/ByteTrue/byspace/internal/home"
)

// GrantsFilename is the target's local allow list: which daemon key may open which port.
//
// It never leaves this daemon. The synced rule list shows tunnels but grants nothing, so a tampered
// replica cannot open a port here.
const GrantsFilename = "tunnel-grants.json"

// Grant allows one daemon, identified by its public key, to open one local port.
type Grant struct {
	PublicKey string `json:"publicKey"`
	Port      int    `json:"port"`
}

type grantsFile struct {
	Version int     `json:"v"`
	Grants  []Grant `json:"grants"`
}

// Grants is the target's allow list.
type Grants struct {
	path   string
	grants []Grant
}

// LoadGrants reads the allow list, or an empty one when the file does not exist yet.
func LoadGrants(homeDir string) (*Grants, error) {
	g := &Grants{path: filepath.Join(homeDir, GrantsFilename)}
	raw, err := os.ReadFile(g.path)
	if os.IsNotExist(err) {
		return g, nil
	}
	if err != nil {
		return nil, err
	}
	var file grantsFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, err
	}
	g.grants = file.Grants
	return g, nil
}

// Allow records that a daemon key may open a port. Repeated calls for the same pair do nothing.
func (g *Grants) Allow(publicKey string, port int) error {
	for _, grant := range g.grants {
		if grant.PublicKey == publicKey && grant.Port == port {
			return nil
		}
	}
	g.grants = append(g.grants, Grant{PublicKey: publicKey, Port: port})
	return g.save()
}

// Allowed reports whether a daemon key may open a port.
func (g *Grants) Allowed(publicKey string, port int) bool {
	for _, grant := range g.grants {
		if grant.PublicKey == publicKey && grant.Port == port {
			return true
		}
	}
	return false
}

// List returns the grants, for the UI to show which tunnels are authorized.
func (g *Grants) List() []Grant {
	out := make([]Grant, len(g.grants))
	copy(out, g.grants)
	return out
}

func (g *Grants) save() error {
	payload, err := json.Marshal(grantsFile{Version: 1, Grants: g.grants})
	if err != nil {
		return err
	}
	return home.WriteAtomic(g.path, append(payload, '\n'), 0o600)
}

// PublicKeyOf formats a raw key the way grants store it, so a check and an Allow agree.
func PublicKeyOf(raw []byte) string {
	return base64.StdEncoding.EncodeToString(raw)
}
