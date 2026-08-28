package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type APIClient struct {
	client *http.Client
}

type DeviceAuthorization struct {
	DeviceCode              string `json:"deviceCode"`
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete"`
	ExpiresAt               string `json:"expiresAt"`
	Interval                int    `json:"interval"`
}

type AuthorizationPoll struct {
	Status         string `json:"status"`
	Interval       int    `json:"interval"`
	Credential     string `json:"credential,omitempty"`
	OrganizationID string `json:"organizationId,omitempty"`
}

type EnrollmentToken struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

func NewAPIClient() *APIClient {
	return &APIClient{client: &http.Client{
		Timeout: hubRequestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}
}

func (client *APIClient) StartAuthorization(ctx context.Context, origin string) (DeviceAuthorization, error) {
	var result DeviceAuthorization
	if err := client.request(ctx, origin, "/api/v1/cli-authorizations", http.MethodPost, "", map[string]any{}, http.StatusCreated, &result); err != nil {
		return DeviceAuthorization{}, err
	}
	if result.DeviceCode == "" || result.UserCode == "" || result.VerificationURI == "" || result.VerificationURIComplete == "" || result.Interval <= 0 {
		return DeviceAuthorization{}, errors.New("Hub CLI authorization response is incomplete")
	}
	if _, err := time.Parse(time.RFC3339, result.ExpiresAt); err != nil {
		return DeviceAuthorization{}, errors.New("Hub CLI authorization expiry is invalid")
	}
	if err := ValidateHTTPURL(origin, result.VerificationURI); err != nil {
		return DeviceAuthorization{}, errors.New("Hub CLI verification URL is invalid")
	}
	if err := ValidateHTTPURL(origin, result.VerificationURIComplete); err != nil {
		return DeviceAuthorization{}, errors.New("Hub CLI complete verification URL is invalid")
	}
	return result, nil
}

func (client *APIClient) PollAuthorization(ctx context.Context, origin, deviceCode string) (AuthorizationPoll, error) {
	var result AuthorizationPoll
	if err := client.request(ctx, origin, "/api/v1/cli-authorizations/poll", http.MethodPost, "", map[string]string{"deviceCode": deviceCode}, http.StatusOK, &result); err != nil {
		return AuthorizationPoll{}, err
	}
	if result.Interval <= 0 {
		return AuthorizationPoll{}, errors.New("Hub CLI authorization polling interval is invalid")
	}
	switch result.Status {
	case "authorized":
		if result.Credential == "" || result.OrganizationID == "" {
			return AuthorizationPoll{}, errors.New("Hub CLI authorization credential is incomplete")
		}
	case "pending", "slow_down", "denied", "expired", "disclosed":
		if result.Credential != "" || result.OrganizationID != "" {
			return AuthorizationPoll{}, errors.New("Hub CLI authorization response disclosed unexpected authority")
		}
	default:
		return AuthorizationPoll{}, errors.New("Hub CLI authorization status is unsupported")
	}
	return result, nil
}

func (client *APIClient) IssueEnrollmentToken(ctx context.Context, origin, credential string) (EnrollmentToken, error) {
	var result EnrollmentToken
	if err := client.request(ctx, origin, "/api/v1/daemons/enrollment-tokens", http.MethodPost, credential, nil, http.StatusCreated, &result); err != nil {
		return EnrollmentToken{}, err
	}
	if len(result.Token) < 32 || len(result.Token) > 16<<10 {
		return EnrollmentToken{}, errors.New("Hub daemon enrollment response contained an invalid token")
	}
	if _, err := time.Parse(time.RFC3339, result.ExpiresAt); err != nil {
		return EnrollmentToken{}, errors.New("Hub daemon enrollment expiry is invalid")
	}
	return result, nil
}

func (client *APIClient) request(ctx context.Context, origin, path, method, credential string, body any, expectedStatus int, destination any) error {
	endpoint, err := joinOriginPath(origin, path)
	if err != nil {
		return err
	}
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode Hub request: %w", err)
		}
		payload = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, payload)
	if err != nil {
		return fmt.Errorf("create Hub request: %w", err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	response, err := client.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Hub request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		return fmt.Errorf("Hub request failed (%d)", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxHubResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read Hub response: %w", err)
	}
	if len(data) > maxHubResponseBytes {
		return errors.New("Hub response is too large")
	}
	if err := decodeStrictJSON(data, destination); err != nil {
		return fmt.Errorf("decode Hub response: %w", err)
	}
	return nil
}
