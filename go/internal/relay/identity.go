package relay

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
)

const identityVersion = 1

// Identity is the stable daemon Relay keypair and pairing capability.
type Identity struct {
	PublicKey       [KeySize]byte
	SecretKey       [KeySize]byte
	ClientAuthToken [ClientAuthSize]byte
}

type identityFile struct {
	Version            int    `json:"version"`
	PublicKeyB64       string `json:"publicKeyB64"`
	SecretKeyB64       string `json:"secretKeyB64"`
	ClientAuthTokenB64 string `json:"clientAuthTokenB64"`
}

func IdentityPath(home string) string {
	return filepath.Join(home, "state", "relay-identity-v1.json")
}

// LoadOrCreateIdentity loads one private identity or creates it atomically.
func LoadOrCreateIdentity(path string) (Identity, error) {
	identity, err := loadIdentity(path)
	if err == nil {
		return identity, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return Identity{}, err
	}

	publicKey, secretKey, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return Identity{}, fmt.Errorf("generate Relay identity: %w", err)
	}
	identity = Identity{PublicKey: *publicKey, SecretKey: *secretKey}
	if _, err := rand.Read(identity.ClientAuthToken[:]); err != nil {
		return Identity{}, fmt.Errorf("generate Relay client auth token: %w", err)
	}
	if err := saveNewIdentity(path, identity); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return loadIdentity(path)
		}
		return Identity{}, err
	}
	return identity, nil
}

func (identity Identity) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(identity.PublicKey[:])
}

func (identity Identity) ClientAuthTokenBase64() string {
	return base64.StdEncoding.EncodeToString(identity.ClientAuthToken[:])
}

func loadIdentity(path string) (Identity, error) {
	if _, err := ValidatePrivateFile(path); err != nil {
		return Identity{}, fmt.Errorf("Relay identity %s must be private: %w", path, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Identity{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var stored identityFile
	if err := decoder.Decode(&stored); err != nil {
		return Identity{}, fmt.Errorf("decode Relay identity %s: %w", path, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Identity{}, fmt.Errorf("decode Relay identity %s: trailing JSON content", path)
	}
	if stored.Version != identityVersion {
		return Identity{}, fmt.Errorf("Relay identity %s has version %d, want %d", path, stored.Version, identityVersion)
	}
	publicKey, err := decodeIdentityField("public key", stored.PublicKeyB64, KeySize)
	if err != nil {
		return Identity{}, fmt.Errorf("Relay identity %s: %w", path, err)
	}
	secretKey, err := decodeIdentityField("secret key", stored.SecretKeyB64, KeySize)
	if err != nil {
		return Identity{}, fmt.Errorf("Relay identity %s: %w", path, err)
	}
	token, err := decodeIdentityField("client auth token", stored.ClientAuthTokenB64, ClientAuthSize)
	if err != nil {
		return Identity{}, fmt.Errorf("Relay identity %s: %w", path, err)
	}
	derivedPublic, err := curve25519.X25519(secretKey, curve25519.Basepoint)
	if err != nil || !bytes.Equal(derivedPublic, publicKey) {
		return Identity{}, fmt.Errorf("Relay identity %s public key does not match its secret key", path)
	}
	var identity Identity
	copy(identity.PublicKey[:], publicKey)
	copy(identity.SecretKey[:], secretKey)
	copy(identity.ClientAuthToken[:], token)
	return identity, nil
}

func saveNewIdentity(path string, identity Identity) (saveErr error) {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create Relay state directory %s: %w", directory, err)
	}
	if err := securePrivateDirectory(directory); err != nil {
		return fmt.Errorf("secure Relay state directory %s: %w", directory, err)
	}
	stored := identityFile{
		Version:            identityVersion,
		PublicKeyB64:       identity.PublicKeyBase64(),
		SecretKeyB64:       base64.StdEncoding.EncodeToString(identity.SecretKey[:]),
		ClientAuthTokenB64: identity.ClientAuthTokenBase64(),
	}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Relay identity %s: %w", path, err)
	}
	data = append(data, '\n')
	temporary, err := os.CreateTemp(directory, ".relay-identity-v1-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary Relay identity in %s: %w", directory, err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := securePrivateFile(temporaryPath); err != nil {
		return fmt.Errorf("secure temporary Relay identity %s: %w", temporaryPath, err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary Relay identity %s: %w", temporaryPath, err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary Relay identity %s: %w", temporaryPath, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Relay identity %s: %w", temporaryPath, err)
	}
	closed = true
	if err := installIdentityFile(temporaryPath, path); err != nil {
		return fmt.Errorf("install Relay identity %s: %w", path, err)
	}
	if err := syncIdentityDirectory(directory); err != nil {
		return fmt.Errorf("sync Relay identity directory %s: %w", directory, err)
	}
	return nil
}

func decodeIdentityField(name, encoded string, size int) ([]byte, error) {
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != encoded {
		return nil, fmt.Errorf("invalid %s encoding", name)
	}
	if len(decoded) != size {
		return nil, fmt.Errorf("invalid %s length: got %d, want %d", name, len(decoded), size)
	}
	return decoded, nil
}
