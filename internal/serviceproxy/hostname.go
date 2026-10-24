// Package serviceproxy exposes workspace service scripts at stable URLs.
//
// Ported from service-proxy.ts. A `type: "service"` script is a dev server: it binds a port and
// someone opens it in a browser. Without this package the script runs and the URL does not exist,
// so the feature is half delivered.
//
// The hostname carries three facts so one browser tab is enough to know what you are looking at:
// the script name, the branch (when it is not the default), and the project. `dev--main--byspace`
// would be noise, so the default branch is omitted.
package serviceproxy

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
	"unicode"
)

// MaxDNSLabelLength is the DNS limit for one label.
const MaxDNSLabelLength = 63

// hashSuffixLength is how much of the digest survives when a label must be shortened.
const hashSuffixLength = 8

// ToHostnameLabel makes a DNS-safe label.
//
// NFKD then strip combining marks, so "Café" becomes "cafe" rather than losing the letter
// entirely — a decomposed accent would otherwise become a hyphen and change the meaning.
func ToHostnameLabel(value string) string {
	decomposed := decompose(value)
	var builder strings.Builder
	lastWasDash := false
	for _, r := range strings.ToLower(decomposed) {
		if unicode.Is(unicode.Mn, r) {
			// A combining mark carries no letter of its own.
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastWasDash = false
			continue
		}
		if !lastWasDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastWasDash = true
		}
	}
	out := strings.Trim(builder.String(), "-")
	if out == "" {
		return "untitled"
	}
	return out
}

// decompose splits accented characters into base plus combining mark.
//
// A small table rather than a full Unicode normalisation table: the labels that reach this point
// are script names, branch names and project names, and covering Latin-1 plus the common Latin
// Extended-A range is enough to keep "café" and "naïve" readable. Anything else falls through to
// the hyphen rule, which still produces a valid label.
func decompose(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if base, ok := latinDecompositions[r]; ok {
			builder.WriteRune(base)
			builder.WriteRune('\u0301')
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

// latinDecompositions maps an accented letter to its base letter.
var latinDecompositions = map[rune]rune{
	'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a',
	'ç': 'c', 'ć': 'c', 'č': 'c',
	'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
	'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'į': 'i',
	'ñ': 'n', 'ń': 'n', 'ň': 'n',
	'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ō': 'o', 'ő': 'o',
	'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u', 'ů': 'u', 'ű': 'u',
	'ý': 'y', 'ÿ': 'y',
	'š': 's', 'ś': 's', 'ž': 'z', 'ź': 'z', 'ż': 'z',
	'ł': 'l', 'ľ': 'l', 'ď': 'd', 'đ': 'd', 'ť': 't', 'ř': 'r',
}

// HashLabel returns the short digest used as a disambiguating suffix.
func HashLabel(label string) string {
	digest := sha256.Sum256([]byte(label))
	return hex.EncodeToString(digest[:])[:hashSuffixLength]
}

// CapDNSLabel shortens a label to the DNS limit, keeping a digest so two long names that share a
// prefix do not collide.
func CapDNSLabel(label string) string {
	if len(label) <= MaxDNSLabelLength {
		return label
	}
	suffix := HashLabel(label)
	maxPrefix := MaxDNSLabelLength - len(suffix) - 2
	prefix := strings.TrimRight(label[:maxPrefix], "-")
	if prefix == "" {
		prefix = "svc"
	}
	return prefix + "--" + suffix
}

// ServiceIdentity is what a hostname is built from.
type ServiceIdentity struct {
	ProjectSlug string
	// BranchName is nil for a workspace with no branch; the default branch is omitted from the
	// hostname because "dev--main--byspace" says nothing a user needs.
	BranchName *string
	ScriptName string
}

// BuildProxyLabel composes the DNS label for one service.
func BuildProxyLabel(service ServiceIdentity) string {
	labels := []string{ToHostnameLabel(service.ScriptName)}
	if !isDefaultBranch(service.BranchName) {
		labels = append(labels, ToHostnameLabel(*service.BranchName))
	}
	labels = append(labels, ToHostnameLabel(service.ProjectSlug))
	return CapDNSLabel(strings.Join(labels, "--"))
}

// isDefaultBranch reports whether the branch is one whose name adds no information.
func isDefaultBranch(branch *string) bool {
	if branch == nil {
		return true
	}
	switch *branch {
	case "main", "master", "":
		return true
	}
	return false
}

// BuildLocalHostname returns the `<label>.localhost` hostname.
//
// `.localhost` resolves to loopback on every platform without a hosts entry, which is why the
// local form uses it rather than an IP.
func BuildLocalHostname(service ServiceIdentity) string {
	return BuildProxyLabel(service) + ".localhost"
}

// BuildPublicHostname returns the `<label>.<baseHost>` hostname.
func BuildPublicHostname(publicBaseURL string, service ServiceIdentity) (string, error) {
	base, err := url.Parse(publicBaseURL)
	if err != nil {
		return "", err
	}
	return BuildProxyLabel(service) + "." + base.Hostname(), nil
}

// BuildPublicURL returns the full URL for a service behind a public base URL.
func BuildPublicURL(publicBaseURL string, service ServiceIdentity) (string, error) {
	base, err := url.Parse(publicBaseURL)
	if err != nil {
		return "", err
	}
	hostname, err := BuildPublicHostname(publicBaseURL, service)
	if err != nil {
		return "", err
	}
	port := ""
	if base.Port() != "" {
		port = ":" + base.Port()
	}
	scheme := base.Scheme
	if scheme == "" {
		scheme = "https"
	}
	return scheme + "://" + hostname + port, nil
}
