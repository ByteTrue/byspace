package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const hubRequestTimeout = 15 * time.Second

const (
	maxHubResponseBytes = 64 << 10
	maxHubRetryAfter    = 5 * time.Minute
)

type enrollmentRequest struct {
	DaemonID           string
	IdempotencyKey     string
	HubOrigin          string
	Token              string
	Hostname           string
	ServerID           string
	DaemonPublicKey    string
	CredentialVerifier string
	Scopes             []string
}

type enrollmentResult struct {
	DaemonID     string   `json:"daemonId"`
	Scopes       []string `json:"scopes"`
	WebSocketURL string   `json:"webSocketUrl"`
}

type revocationRequest struct {
	DaemonID   string
	HubOrigin  string
	Credential string
}

type socketRequest struct {
	DaemonID     string
	WebSocketURL string
	Credential   string
}

type hubSocket interface {
	Read(context.Context) (websocket.MessageType, []byte, error)
	Close(websocket.StatusCode, string) error
	CloseNow() error
}

type relationshipRemote interface {
	Enroll(context.Context, enrollmentRequest) (enrollmentResult, error)
	Revoke(context.Context, revocationRequest) error
	Dial(context.Context, socketRequest) (hubSocket, int, error)
}

type enrollmentRejectedError struct {
	statusCode int
	reason     string
}

func (err *enrollmentRejectedError) Error() string {
	if err.reason != "" {
		return err.reason
	}
	return fmt.Sprintf("Hub enrollment failed (%d)", err.statusCode)
}

type retryAfterError struct {
	statusCode int
	delay      time.Duration
}

func (err *retryAfterError) Error() string {
	return fmt.Sprintf("Hub enrollment failed transiently (%d)", err.statusCode)
}

type directRemote struct {
	client *http.Client
}

func newDirectRemote() *directRemote {
	return &directRemote{client: &http.Client{
		Timeout: hubRequestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}
}

func (remote *directRemote) Enroll(ctx context.Context, input enrollmentRequest) (enrollmentResult, error) {
	endpoint, err := joinOriginPath(input.HubOrigin, "/api/daemons/enroll")
	if err != nil {
		return enrollmentResult{}, err
	}
	body, err := json.Marshal(struct {
		DaemonID           string   `json:"daemonId"`
		IdempotencyKey     string   `json:"idempotencyKey"`
		Hostname           string   `json:"hostname,omitempty"`
		ServerID           string   `json:"serverId"`
		DaemonPublicKey    string   `json:"daemonPublicKey"`
		CredentialVerifier string   `json:"credentialVerifier"`
		Scopes             []string `json:"scopes"`
	}{
		DaemonID:           input.DaemonID,
		IdempotencyKey:     input.IdempotencyKey,
		Hostname:           input.Hostname,
		ServerID:           input.ServerID,
		DaemonPublicKey:    input.DaemonPublicKey,
		CredentialVerifier: input.CredentialVerifier,
		Scopes:             input.Scopes,
	})
	if err != nil {
		return enrollmentResult{}, fmt.Errorf("encode Hub enrollment: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return enrollmentResult{}, fmt.Errorf("create Hub enrollment request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+input.Token)
	request.Header.Set("Content-Type", "application/json")
	response, err := remote.client.Do(request)
	if err != nil {
		return enrollmentResult{}, fmt.Errorf("send Hub enrollment request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if transientEnrollmentStatus(response.StatusCode) {
			return enrollmentResult{}, &retryAfterError{
				statusCode: response.StatusCode,
				delay:      parseRetryAfter(response.Header.Get("Retry-After")),
			}
		}
		return enrollmentResult{}, &enrollmentRejectedError{statusCode: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxHubResponseBytes+1))
	if err != nil {
		return enrollmentResult{}, fmt.Errorf("read Hub enrollment response: %w", err)
	}
	if len(data) > maxHubResponseBytes {
		return enrollmentResult{}, errors.New("Hub enrollment response is too large")
	}
	var result enrollmentResult
	if err := decodeJSON(data, &result); err != nil {
		return enrollmentResult{}, fmt.Errorf("decode Hub enrollment response: %w", err)
	}
	if err := ValidateWebSocketURL(input.HubOrigin, result.WebSocketURL); err != nil {
		return enrollmentResult{}, err
	}
	return result, nil
}

func (remote *directRemote) Revoke(ctx context.Context, input revocationRequest) error {
	endpoint, err := joinOriginPath(input.HubOrigin, "/api/daemons/"+input.DaemonID)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create Hub revocation request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+input.Credential)
	response, err := remote.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Hub revocation request: %w", err)
	}
	defer response.Body.Close()
	if (response.StatusCode >= 200 && response.StatusCode < 300) || response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("Hub revocation failed (%d)", response.StatusCode)
}

func (remote *directRemote) Dial(ctx context.Context, input socketRequest) (hubSocket, int, error) {
	connection, response, err := websocket.Dial(ctx, input.WebSocketURL, &websocket.DialOptions{
		HTTPClient: remote.client,
		HTTPHeader: http.Header{
			"Authorization":     []string{"Bearer " + input.Credential},
			"X-Paseo-Daemon-Id": []string{input.DaemonID},
		},
	})
	statusCode := 0
	if response != nil {
		statusCode = response.StatusCode
		if response.Body != nil {
			_ = response.Body.Close()
		}
	}
	if err != nil {
		return nil, statusCode, err
	}
	connection.SetReadLimit(1 << 20)
	return connection, statusCode, nil
}

func transientEnrollmentStatus(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout || statusCode == http.StatusTooEarly ||
		statusCode == http.StatusTooManyRequests || statusCode >= 500
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds > 0 {
		return min(time.Duration(seconds)*time.Second, maxHubRetryAfter)
	}
	if deadline, err := http.ParseTime(value); err == nil {
		return min(max(time.Until(deadline), time.Duration(0)), maxHubRetryAfter)
	}
	return 0
}

func decodeJSON(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("trailing JSON content")
	}
	return nil
}
