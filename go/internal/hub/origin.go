package hub

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

func NormalizeOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Opaque != "" {
		return "", errors.New("Hub URL must be an absolute HTTP or HTTPS URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("Hub URL must use HTTP or HTTPS")
	}
	if parsed.User != nil {
		return "", errors.New("Hub URL cannot include credentials")
	}
	if (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.ForceQuery {
		return "", errors.New("Hub URL cannot include a path, query, or fragment")
	}
	hostname := strings.ToLower(parsed.Hostname())
	if strings.Contains(hostname, "%") {
		return "", errors.New("Hub URL host is invalid")
	}
	if parsed.Scheme == "http" && !isLoopbackHost(hostname) {
		return "", errors.New("Hub URL must use HTTPS except for loopback development")
	}
	port := parsed.Port()
	if port == "443" && parsed.Scheme == "https" || port == "80" && parsed.Scheme == "http" {
		port = ""
	}
	if strings.Contains(hostname, ":") {
		parsed.Host = "[" + hostname + "]"
	} else {
		parsed.Host = hostname
	}
	if port != "" {
		parsed.Host = net.JoinHostPort(hostname, port)
	}
	parsed.Path, parsed.RawPath = "", ""
	return parsed.String(), nil
}

func ValidateHTTPURL(origin, value string) error {
	hubOrigin, err := url.Parse(origin)
	if err != nil {
		return errors.New("Hub origin is invalid")
	}
	candidate, err := url.Parse(value)
	if err != nil || candidate.Scheme == "" || candidate.Host == "" || candidate.Opaque != "" {
		return errors.New("Hub URL is invalid")
	}
	if candidate.User != nil || candidate.Fragment != "" || candidate.Scheme != hubOrigin.Scheme || !strings.EqualFold(candidate.Host, hubOrigin.Host) {
		return errors.New("Hub URL must match the Hub origin")
	}
	return nil
}

func ValidateWebSocketURL(origin, value string) error {
	hubOrigin, err := url.Parse(origin)
	if err != nil {
		return errors.New("Hub origin is invalid")
	}
	socket, err := url.Parse(value)
	if err != nil || socket.Scheme == "" || socket.Host == "" || socket.Opaque != "" {
		return errors.New("Hub WebSocket URL is invalid")
	}
	if socket.User != nil || socket.Fragment != "" {
		return errors.New("Hub WebSocket URL cannot include credentials or a fragment")
	}
	expectedScheme := "wss"
	if hubOrigin.Scheme == "http" {
		expectedScheme = "ws"
	}
	if socket.Scheme != expectedScheme || !strings.EqualFold(socket.Host, hubOrigin.Host) {
		return errors.New("Hub WebSocket URL must match the Hub origin")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func joinOriginPath(origin, path string) (string, error) {
	parsed, err := url.Parse(origin)
	if err != nil {
		return "", fmt.Errorf("parse Hub origin: %w", err)
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/") + path
	parsed.RawPath = ""
	return parsed.String(), nil
}
