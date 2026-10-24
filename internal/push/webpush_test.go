package push

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"
)

// buildTestSubscription makes a real browser-shaped subscription.
func buildTestSubscription(t *testing.T) Subscription {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatal(err)
	}
	return Subscription{
		Endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
		P256DH:   base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}
}

// The body must be a valid RFC 8188 aes128gcm record: salt(16) | rs(4) | idlen(1) | keyid | ct.
func TestEncryptPayloadLayout(t *testing.T) {
	sub := buildTestSubscription(t)
	payload := []byte(`{"title":"Task finished"}`)

	body, err := EncryptPayload(sub, payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) <= 16+4+1+65 {
		t.Fatalf("body too short: %d", len(body))
	}

	recordSize := binary.BigEndian.Uint32(body[16:20])
	if recordSize != 4096 {
		t.Fatalf("record size = %d", recordSize)
	}
	idLen := int(body[20])
	if idLen != 65 {
		t.Fatalf("keyid length = %d, want 65 (an uncompressed P-256 point)", idLen)
	}
	keyID := body[21 : 21+idLen]
	if keyID[0] != 0x04 {
		t.Fatalf("keyid is not an uncompressed point: first byte 0x%02x", keyID[0])
	}

	// The ciphertext must not contain the plaintext: that is the whole point.
	if strings.Contains(string(body), "Task finished") {
		t.Fatal("payload appears in plaintext; encryption did not happen")
	}
}

// Two encryptions of the same payload must differ (fresh salt and ephemeral key each time), or
// the push service could correlate identical notifications.
func TestEncryptPayloadIsRandomized(t *testing.T) {
	sub := buildTestSubscription(t)
	a, err := EncryptPayload(sub, []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := EncryptPayload(sub, []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	if string(a) == string(b) {
		t.Fatal("two encryptions produced identical bytes")
	}
}

// A malformed subscription must be rejected, not silently encrypted to nowhere.
func TestEncryptPayloadRejectsBadKeys(t *testing.T) {
	bad := Subscription{Endpoint: "https://x/y", P256DH: "not-a-key", Auth: "AAAA"}
	if _, err := EncryptPayload(bad, []byte("x")); err == nil {
		t.Fatal("expected an error for a non-P-256 key")
	}
	tooShort := Subscription{Endpoint: "https://x/y", P256DH: base64.RawURLEncoding.EncodeToString([]byte{1, 2, 3}), Auth: "AAAA"}
	if _, err := EncryptPayload(tooShort, []byte("x")); err == nil {
		t.Fatal("expected an error for a truncated key")
	}
}

// The token field carries both Expo tokens and browser subscriptions; only the JSON shape is a
// subscription.
func TestParseSubscription(t *testing.T) {
	sub := buildTestSubscription(t)
	token, _ := json.Marshal(map[string]any{
		"endpoint": sub.Endpoint,
		"keys":     map[string]string{"p256dh": sub.P256DH, "auth": sub.Auth},
	})
	got, err := ParseSubscription(string(token))
	if err != nil {
		t.Fatal(err)
	}
	if got.Endpoint != sub.Endpoint || got.P256DH != sub.P256DH {
		t.Fatalf("round trip lost data: %+v", got)
	}

	for _, bad := range []string{
		"ExponentPushToken[abc]",
		`{"endpoint":"http://insecure/x","keys":{"p256dh":"a","auth":"b"}}`,
		`{"endpoint":"https://x/y","keys":{"p256dh":"","auth":"b"}}`,
		`{"endpoint":"https://x/y"}`,
		`{`,
	} {
		if _, err := ParseSubscription(bad); err == nil {
			t.Fatalf("%q must not parse as a subscription", bad)
		}
	}
}

// A VAPID token minted for one push service must not be replayable against another.
func TestAudienceIsThePushServiceOrigin(t *testing.T) {
	aud, err := audienceFor("https://fcm.googleapis.com/fcm/send/abc")
	if err != nil || aud != "https://fcm.googleapis.com" {
		t.Fatalf("aud = %q err = %v", aud, err)
	}
	aud, err = audienceFor("https://updates.push.services.mozilla.com/wpush/v2/xyz")
	if err != nil || aud != "https://updates.push.services.mozilla.com" {
		t.Fatalf("aud = %q err = %v", aud, err)
	}
	if _, err := audienceFor("https://nohost"); err == nil {
		t.Fatal("an endpoint without a path should be rejected")
	}
}

// The Authorization header must be a vapid token carrying the public key, since that is what the
// push service verifies the signature against.
func TestVAPIDAuthorizationShape(t *testing.T) {
	sub := buildTestSubscription(t)
	keys := Keys{PublicKey: mustVAPIDPublic(t), PrivateKey: mustVAPIDPrivate(t)}
	c := &Client{Keys: keys}
	header, err := c.vapidAuthorization(sub.Endpoint, 3600)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(header, "vapid t=") {
		t.Fatalf("header = %q", header)
	}
	if !strings.Contains(header, ", k=") {
		t.Fatalf("header is missing the public key: %q", header)
	}
	// The JWT must have three segments.
	token := strings.TrimPrefix(strings.SplitN(header, ", k=", 2)[0], "vapid t=")
	if parts := strings.Split(token, "."); len(parts) != 3 {
		t.Fatalf("JWT has %d segments: %q", len(parts), token)
	}
}

func mustVAPIDPublic(t *testing.T) string {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes())
}

func mustVAPIDPrivate(t *testing.T) string {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(k.Bytes())
}

// A subscription the push service reports as gone must be prunable, not retried forever.
func TestIsGone(t *testing.T) {
	if !IsGone(404) || !IsGone(410) {
		t.Fatal("404/410 mean the subscription is gone")
	}
	if IsGone(500) || IsGone(429) {
		t.Fatal("transient failures must stay retryable")
	}
}
