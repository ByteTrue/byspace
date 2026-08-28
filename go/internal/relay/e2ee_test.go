package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type e2eeFixture struct {
	Version   int    `json:"version"`
	Algorithm string `json:"algorithm"`
	Framing   string `json:"framing"`
	Keys      struct {
		DaemonSecretKey string `json:"daemonSecretKeyB64"`
		DaemonPublicKey string `json:"daemonPublicKeyB64"`
		ClientSecretKey string `json:"clientSecretKeyB64"`
		ClientPublicKey string `json:"clientPublicKeyB64"`
		SharedKey       string `json:"sharedKeyB64"`
	} `json:"keys"`
	ClientAuth struct {
		Scheme             string `json:"scheme"`
		TokenB64           string `json:"tokenB64"`
		ChallengeB64       string `json:"challengeB64"`
		ClientPublicKeyB64 string `json:"clientPublicKeyB64"`
		BinaryCiphertext   bool   `json:"binaryCiphertext"`
		ProofB64           string `json:"proofB64"`
	} `json:"clientAuth"`
	Vectors []struct {
		Name         string `json:"name"`
		Encoding     string `json:"encoding"`
		Plaintext    string `json:"plaintext"`
		PlaintextB64 string `json:"plaintextB64"`
		NonceB64     string `json:"nonceB64"`
		BundleB64    string `json:"bundleB64"`
	} `json:"vectors"`
	Invalid struct {
		LowOrderPublicKey string `json:"lowOrderPublicKeyB64"`
		ShortBundle       string `json:"shortBundleB64"`
		TamperedBundle    string `json:"tamperedBundleB64"`
	} `json:"invalid"`
}

func TestE2EEGoldenFixture(t *testing.T) {
	fixture := loadE2EEFixture(t)
	if fixture.Version != 1 || fixture.Algorithm != "curve25519-xsalsa20-poly1305" || fixture.Framing != "nonce24-ciphertext" {
		t.Fatalf("unexpected E2EE contract: version=%d algorithm=%q framing=%q", fixture.Version, fixture.Algorithm, fixture.Framing)
	}

	daemonSecret := decodeFixtureBase64(t, fixture.Keys.DaemonSecretKey)
	clientSecret := decodeFixtureBase64(t, fixture.Keys.ClientSecretKey)
	daemonPublic := decodeFixtureBase64(t, fixture.Keys.DaemonPublicKey)
	clientPublic := decodeFixtureBase64(t, fixture.Keys.ClientPublicKey)
	expectedShared := decodeFixtureBase64(t, fixture.Keys.SharedKey)

	daemonShared, err := DeriveSharedKey(daemonSecret, clientPublic)
	if err != nil {
		t.Fatalf("derive daemon shared key: %v", err)
	}
	clientShared, err := DeriveSharedKey(clientSecret, daemonPublic)
	if err != nil {
		t.Fatalf("derive client shared key: %v", err)
	}
	if !bytes.Equal(daemonShared[:], expectedShared) || daemonShared != clientShared {
		t.Fatal("derived shared keys do not match the golden fixture")
	}

	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			expectedPlaintext := []byte(vector.Plaintext)
			if vector.Encoding == "base64" {
				expectedPlaintext = decodeFixtureBase64(t, vector.PlaintextB64)
			}
			nonce := decodeFixtureBase64(t, vector.NonceB64)
			expectedBundle := decodeFixtureBase64(t, vector.BundleB64)

			bundle, err := Seal(daemonShared, nonce, expectedPlaintext)
			if err != nil {
				t.Fatalf("seal: %v", err)
			}
			if !bytes.Equal(bundle, expectedBundle) {
				t.Fatal("sealed bundle does not match the golden fixture")
			}
			plaintext, err := Open(daemonShared, expectedBundle)
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			if !bytes.Equal(plaintext, expectedPlaintext) {
				t.Fatal("opened plaintext does not match the golden fixture")
			}
		})
	}
}

func TestClientAuthGoldenFixture(t *testing.T) {
	fixture := loadE2EEFixture(t)
	token := decodeFixtureBase64(t, fixture.ClientAuth.TokenB64)
	challenge := decodeFixtureBase64(t, fixture.ClientAuth.ChallengeB64)
	clientPublicKey := decodeFixtureBase64(t, fixture.ClientAuth.ClientPublicKeyB64)
	expected := decodeFixtureBase64(t, fixture.ClientAuth.ProofB64)

	proof, err := CreateClientAuthProof(token, challenge, clientPublicKey, fixture.ClientAuth.BinaryCiphertext)
	if err != nil {
		t.Fatalf("create client auth proof: %v", err)
	}
	if fixture.ClientAuth.Scheme != "hmac-sha256-v1" || !bytes.Equal(proof[:], expected) {
		t.Fatal("client auth proof does not match the golden fixture")
	}
	if !VerifyClientAuthProof(token, challenge, clientPublicKey, true, proof[:]) {
		t.Fatal("valid client auth proof was rejected")
	}
	otherChallenge := append([]byte(nil), challenge...)
	otherChallenge[0] ^= 1
	if VerifyClientAuthProof(token, otherChallenge, clientPublicKey, true, proof[:]) {
		t.Fatal("proof was not bound to the challenge")
	}
	if VerifyClientAuthProof(token, challenge, clientPublicKey, false, proof[:]) {
		t.Fatal("proof was not bound to ciphertext capabilities")
	}
}

func TestE2EERejectsInvalidInputs(t *testing.T) {
	fixture := loadE2EEFixture(t)
	secret := decodeFixtureBase64(t, fixture.Keys.DaemonSecretKey)
	peer := decodeFixtureBase64(t, fixture.Keys.ClientPublicKey)
	sharedBytes := decodeFixtureBase64(t, fixture.Keys.SharedKey)
	var shared [KeySize]byte
	copy(shared[:], sharedBytes)

	if _, err := DeriveSharedKey(secret[:len(secret)-1], peer); err == nil {
		t.Fatal("short secret key was accepted")
	}
	if _, err := DeriveSharedKey(secret, peer[:len(peer)-1]); err == nil {
		t.Fatal("short peer public key was accepted")
	}
	if _, err := DeriveSharedKey(secret, decodeFixtureBase64(t, fixture.Invalid.LowOrderPublicKey)); !errors.Is(err, ErrInvalidPeerPublicKey) {
		t.Fatalf("low-order peer error = %v, want ErrInvalidPeerPublicKey", err)
	}
	if _, err := Seal(shared, make([]byte, NonceSize-1), nil); err == nil {
		t.Fatal("short nonce was accepted")
	}
	if _, err := Open(shared, decodeFixtureBase64(t, fixture.Invalid.ShortBundle)); err == nil {
		t.Fatal("short encrypted bundle was accepted")
	}
	if _, err := Open(shared, decodeFixtureBase64(t, fixture.Invalid.TamperedBundle)); !errors.Is(err, ErrAuthentication) {
		t.Fatalf("tampered bundle error = %v, want ErrAuthentication", err)
	}
}

func loadE2EEFixture(t *testing.T) e2eeFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "fixtures", "relay", "e2ee-v1.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	var fixture e2eeFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode fixture %s: %v", path, err)
	}
	return fixture
}

func decodeFixtureBase64(t *testing.T, encoded string) []byte {
	t.Helper()
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode fixture base64: %v", err)
	}
	if base64.StdEncoding.EncodeToString(decoded) != encoded {
		t.Fatal("fixture base64 is not canonical")
	}
	return decoded
}
