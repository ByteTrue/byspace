package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
)

const pairingOfferFragment = "#offer="

type PairingOfferV3 struct {
	Version            int    `json:"v"`
	ServerID           string `json:"serverId"`
	DaemonPublicKeyB64 string `json:"daemonPublicKeyB64"`
	ClientAuthTokenB64 string `json:"clientAuthTokenB64"`
	Relay              struct {
		Endpoint string `json:"endpoint"`
		UseTLS   bool   `json:"useTls"`
	} `json:"relay"`
}

func ParsePairingOfferURL(raw string) (PairingOfferV3, error) {
	trimmed := strings.TrimSpace(raw)
	index := strings.Index(trimmed, pairingOfferFragment)
	if index < 0 {
		return PairingOfferV3{}, errors.New("pairing offer URL is missing an #offer= fragment")
	}
	encoded := strings.TrimSpace(trimmed[index+len(pairingOfferFragment):])
	payload, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.RawURLEncoding.EncodeToString(payload) != encoded {
		return PairingOfferV3{}, errors.New("pairing offer fragment is not canonical base64url")
	}
	var offer PairingOfferV3
	if err := decodeStrictJSON(payload, &offer); err != nil {
		return PairingOfferV3{}, fmt.Errorf("decode pairing offer: %w", err)
	}
	if err := offer.Validate(); err != nil {
		return PairingOfferV3{}, err
	}
	return offer, nil
}

func (offer PairingOfferV3) Validate() error {
	if offer.Version != 3 {
		return fmt.Errorf("pairing offer version %d is unsupported", offer.Version)
	}
	if !validServerID(offer.ServerID) {
		return errors.New("pairing offer has an invalid server ID")
	}
	daemonPublicKey, err := decodeCanonicalBase64(offer.DaemonPublicKeyB64, KeySize)
	if err != nil {
		return errors.New("pairing offer has an invalid daemon public key")
	}
	var probeSecret [KeySize]byte
	probeSecret[0] = 1
	if _, err := DeriveSharedKey(probeSecret[:], daemonPublicKey); err != nil {
		return errors.New("pairing offer has an invalid daemon public key")
	}
	if _, err := decodeCanonicalBase64(offer.ClientAuthTokenB64, ClientAuthSize); err != nil {
		return errors.New("pairing offer has an invalid client authentication token")
	}
	if !validRelayEndpoint(offer.Relay.Endpoint) {
		return errors.New("pairing offer has an invalid Relay endpoint")
	}
	return nil
}

func (offer PairingOfferV3) DaemonPublicKey() ([KeySize]byte, error) {
	return decodeOfferKey(offer.DaemonPublicKeyB64, "daemon public key")
}

func (offer PairingOfferV3) ClientAuthToken() ([ClientAuthSize]byte, error) {
	return decodeOfferKey(offer.ClientAuthTokenB64, "client authentication token")
}

func decodeOfferKey(encoded, label string) ([KeySize]byte, error) {
	var result [KeySize]byte
	decoded, err := decodeCanonicalBase64(encoded, KeySize)
	if err != nil {
		return result, fmt.Errorf("invalid %s", label)
	}
	copy(result[:], decoded)
	return result, nil
}

func validServerID(serverID string) bool {
	if len(serverID) != len("srv_")+12 || !strings.HasPrefix(serverID, "srv_") {
		return false
	}
	for _, character := range serverID[len("srv_"):] {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-') {
			return false
		}
	}
	return true
}

func validRelayEndpoint(endpoint string) bool {
	if endpoint == "" || strings.TrimSpace(endpoint) != endpoint {
		return false
	}
	host, portText, err := net.SplitHostPort(endpoint)
	if err != nil || host == "" || portText == "" || len(portText) > 5 {
		return false
	}
	for _, character := range portText {
		if character < '0' || character > '9' {
			return false
		}
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return false
	}
	if strings.HasPrefix(endpoint, "[") {
		ip := net.ParseIP(host)
		return strings.Contains(host, ":") && ip != nil
	}
	return validIPv4(host) || validHostname(host)
}

func validIPv4(host string) bool {
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return false
	}
	for _, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') || len(part) > 3 {
			return false
		}
		for _, character := range part {
			if character < '0' || character > '9' {
				return false
			}
		}
		value, _ := strconv.Atoi(part)
		if value > 255 {
			return false
		}
	}
	return true
}

func validHostname(host string) bool {
	if len(host) > 253 || strings.Trim(host, ".") != host {
		return false
	}
	numeric := true
	for _, character := range host {
		if character != '.' && (character < '0' || character > '9') {
			numeric = false
			break
		}
	}
	if numeric {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '-') {
				return false
			}
		}
	}
	return true
}

func decodeCanonicalBase64(encoded string, size int) ([]byte, error) {
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != encoded {
		return nil, errors.New("invalid base64")
	}
	if size >= 0 && len(decoded) != size {
		return nil, fmt.Errorf("invalid decoded length: got %d, want %d", len(decoded), size)
	}
	return decoded, nil
}

func decodeStrictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("trailing JSON content")
	}
	return nil
}
