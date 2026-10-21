// Package push delivers Web Push notifications directly from the daemon.
//
// Ported from server/push/web-push-service.ts. The payload is encrypted per RFC 8291 with keys
// the browser generated, so the push service relays ciphertext it cannot read — the daemon never
// hands message content to Google, Mozilla or Apple. VAPID (RFC 8292) authenticates the sender
// without a per-user account, which a self-hosted daemon cannot have.
package push

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/hkdf"
)

// VAPIDSubject is the contact URL advertised to push services.
//
// Push operators use it to reach whoever is sending; a self-hosted daemon has no per-user
// contact, so the project itself is the honest answer.
const VAPIDSubject = "https://github.com/ByteTrue/byspace"

// NotificationTTL is how long a push service may keep an undelivered message.
const NotificationTTL = 12 * 60 * 60

// Subscription is one browser's push subscription.
type Subscription struct {
	Endpoint string
	P256DH   string // base64url, uncompressed P-256 point
	Auth     string // base64url, 16 bytes
}

// ParseSubscription reads the opaque token a browser sent in register_push_token.
//
// Keeping the subscription inside the existing token field is what lets one token store carry
// both Expo tokens and browser subscriptions without a protocol change.
func ParseSubscription(token string) (*Subscription, error) {
	trimmed := strings.TrimSpace(token)
	if !strings.HasPrefix(trimmed, "{") {
		return nil, fmt.Errorf("not a web push subscription")
	}
	var raw struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256DH string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(raw.Endpoint, "https://") {
		return nil, fmt.Errorf("subscription endpoint must be https")
	}
	if raw.Keys.P256DH == "" || raw.Keys.Auth == "" {
		return nil, fmt.Errorf("subscription is missing keys")
	}
	return &Subscription{Endpoint: raw.Endpoint, P256DH: raw.Keys.P256DH, Auth: raw.Keys.Auth}, nil
}

// Keys is the daemon's VAPID keypair.
type Keys struct {
	// PublicKey is the uncompressed P-256 point (65 bytes), base64url encoded.
	PublicKey string
	// PrivateKey is the 32-byte scalar, base64url encoded.
	PrivateKey string
}

// Client sends notifications.
type Client struct {
	Keys Keys
	HTTP *http.Client
	Now  func() time.Time
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

// Send encrypts and delivers one notification.
//
// Returns the HTTP status so the caller can prune a subscription the push service reports as
// gone (404/410) — those are permanent and retrying forever is pointless.
func (c *Client) Send(ctx context.Context, sub Subscription, payload []byte) (int, error) {
	body, err := EncryptPayload(sub, payload)
	if err != nil {
		return 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", fmt.Sprintf("%d", NotificationTTL))

	auth, err := c.vapidAuthorization(sub.Endpoint, NotificationTTL)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", auth)

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp.StatusCode, nil
	}
	return resp.StatusCode, fmt.Errorf("push service returned %d", resp.StatusCode)
}

// IsGone reports whether a status means the subscription no longer exists.
func IsGone(status int) bool { return status == http.StatusNotFound || status == http.StatusGone }

// EncryptPayload builds the aes128gcm body described by RFC 8291 §4.
//
// The layout is: salt(16) | rs(4) | idlen(1) | keyid(65, our ephemeral public key) | ciphertext.
func EncryptPayload(sub Subscription, payload []byte) ([]byte, error) {
	uaPublic, err := decodeBase64URL(sub.P256DH)
	if err != nil {
		return nil, fmt.Errorf("subscription public key: %w", err)
	}
	authSecret, err := decodeBase64URL(sub.Auth)
	if err != nil {
		return nil, fmt.Errorf("subscription auth secret: %w", err)
	}

	curve := ecdh.P256()
	uaKey, err := curve.NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("subscription public key is not a P-256 point: %w", err)
	}
	asKey, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	sharedSecret, err := asKey.ECDH(uaKey)
	if err != nil {
		return nil, err
	}

	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}

	// RFC 8291 §3.3: the auth secret salts the first extract, and the webpush info block
	// (which binds both public keys) is the expand info.
	keyInfo := append([]byte("WebPush: info\x00"), uaPublic...)
	keyInfo = append(keyInfo, asKey.PublicKey().Bytes()...)
	prkKey := hkdf.Extract(sha256.New, sharedSecret, authSecret)
	ikm := expand(prkKey, keyInfo, 32)

	// RFC 8188 §2.1: the content encryption key and nonce derive from the message salt.
	prk := hkdf.Extract(sha256.New, ikm, salt)
	cek := expand(prk, []byte("Content-Encoding: aes128gcm\x00"), 16)
	nonce := expand(prk, []byte("Content-Encoding: nonce\x00"), 12)

	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// The plaintext is the payload followed by the 0x02 delimiter of the final record.
	plaintext := append(append([]byte{}, payload...), 0x02)
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	var out bytes.Buffer
	out.Write(salt)
	// Record size: generous, the payloads are small notification bodies.
	_ = binary.Write(&out, binary.BigEndian, uint32(4096))
	out.WriteByte(byte(len(asKey.PublicKey().Bytes())))
	out.Write(asKey.PublicKey().Bytes())
	out.Write(ciphertext)
	return out.Bytes(), nil
}

// expand runs HKDF-Expand to exactly n bytes.
func expand(prk, info []byte, n int) []byte {
	out := make([]byte, n)
	_, _ = io.ReadFull(hkdf.Expand(sha256.New, prk, info), out)
	return out
}

// vapidAuthorization builds the RFC 8292 Authorization header.
//
// The JWT is ES256 over (audience, exp, sub), where the audience is the push service's origin:
// a token minted for one service must not be replayable against another.
func (c *Client) vapidAuthorization(endpoint string, ttlSeconds int) (string, error) {
	aud, err := audienceFor(endpoint)
	if err != nil {
		return "", err
	}
	privBytes, err := decodeBase64URL(c.Keys.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("vapid private key: %w", err)
	}
	pubBytes, err := decodeBase64URL(c.Keys.PublicKey)
	if err != nil {
		return "", fmt.Errorf("vapid public key: %w", err)
	}

	priv := ecdsaPrivateFromScalar(privBytes)

	now := time.Now()
	if c.Now != nil {
		now = c.Now()
	}
	header := base64URL([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{
		"aud": aud,
		"exp": now.Add(ttlSecondsDuration(ttlSeconds)).Unix(),
		"sub": VAPIDSubject,
	})
	signingInput := header + "." + base64URL(claims)

	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, priv, digest[:])
	if err != nil {
		return "", err
	}
	// JWS ES256 wants the fixed-width r||s pair, not a DER sequence.
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	jwt := signingInput + "." + base64URL(sig)

	return "vapid t=" + jwt + ", k=" + base64URL(pubBytes), nil
}

func ttlSecondsDuration(ttl int) time.Duration {
	return time.Duration(ttl) * time.Second
}

// audienceFor extracts scheme://host from a push endpoint.
func audienceFor(endpoint string) (string, error) {
	trimmed := strings.TrimPrefix(endpoint, "https://")
	host, _, found := strings.Cut(trimmed, "/")
	if !found || host == "" {
		return "", fmt.Errorf("endpoint has no host: %q", endpoint)
	}
	return "https://" + host, nil
}

func base64URL(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func decodeBase64URL(s string) ([]byte, error) {
	// Padding is optional in the JOSE encodings the browser emits.
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.TrimSpace(s), "="))
}

// ecdsaPrivateFromScalar builds a P-256 signing key from a raw 32-byte scalar.
func ecdsaPrivateFromScalar(scalar []byte) *ecdsa.PrivateKey {
	curve := elliptic.P256()
	priv := &ecdsa.PrivateKey{D: new(big.Int).SetBytes(scalar)}
	priv.PublicKey.Curve = curve
	priv.PublicKey.X, priv.PublicKey.Y = curve.ScalarBaseMult(scalar)
	return priv
}
