package providers

import (
	"net/http"
	"net/url"
	"time"
)

type openCodeBasicAuthTransport struct {
	password string
	base     http.RoundTripper
}

func (t openCodeBasicAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.password != "" {
		req = req.Clone(req.Context())
		req.SetBasicAuth("opencode", t.password)
	}
	return t.base.RoundTrip(req)
}

func newOpenCodeHTTPClient(password string) *http.Client {
	return newOpenCodeHTTPClientWithTimeout(password, 30*time.Second)
}

func newOpenCodeStreamHTTPClient(password string) *http.Client {
	return newOpenCodeHTTPClientWithTimeout(password, 0)
}

func newOpenCodeHTTPClientWithTimeout(password string, timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: openCodeBasicAuthTransport{
			password: password,
			base:     &http.Transport{Proxy: nil},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 0 && !sameOpenCodeOrigin(req.URL, via[0].URL) {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

func sameOpenCodeOrigin(a, b *url.URL) bool {
	return a.Scheme == b.Scheme && a.Host == b.Host
}
