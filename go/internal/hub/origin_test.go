package hub

import "testing"

func TestNormalizeOrigin(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name  string
		input string
		want  string
	}{
		{name: "https", input: " https://hub.byspace.test/ ", want: "https://hub.byspace.test"},
		{name: "canonical", input: "https://HUB.byspace.test:443/", want: "https://hub.byspace.test"},
		{name: "loopback", input: "http://127.0.0.1:3000/", want: "http://127.0.0.1:3000"},
		{name: "ipv6", input: "http://[::1]:3000/", want: "http://[::1]:3000"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeOrigin(test.input)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("NormalizeOrigin() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNormalizeOriginRejectsUnsafeURLs(t *testing.T) {
	t.Parallel()
	for _, input := range []string{
		"http://hub.byspace.test",
		"https://user:secret@hub.byspace.test",
		"https://hub.byspace.test/base",
		"http://127.0.0.2:3000",
		"https://hub.byspace.test?token=secret",
		"https://hub.byspace.test/#secret",
		"wss://hub.byspace.test",
		"hub.byspace.test",
	} {
		if _, err := NormalizeOrigin(input); err == nil {
			t.Fatalf("NormalizeOrigin(%q) succeeded", input)
		}
	}
}

func TestValidateWebSocketURLRequiresSameAuthority(t *testing.T) {
	t.Parallel()
	if err := ValidateWebSocketURL(
		"https://hub.byspace.test",
		"wss://hub.byspace.test/api/daemons/socket",
	); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{
		"ws://hub.byspace.test/api/daemons/socket",
		"wss://other.byspace.test/api/daemons/socket",
		"wss://hub.byspace.test:444/api/daemons/socket",
		"wss://user:secret@hub.byspace.test/api/daemons/socket",
		"wss://hub.byspace.test/api/daemons/socket#secret",
	} {
		if err := ValidateWebSocketURL("https://hub.byspace.test", value); err == nil {
			t.Fatalf("ValidateWebSocketURL(%q) succeeded", value)
		}
	}
}
