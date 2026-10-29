package selfupdate

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Repo is the GitHub repository where BySpace releases are published.
const Repo = "ByteTrue/byspace"

// GUI reports whether this binary was built with the Wails v3 desktop/mobile GUI (!nogui).
var GUI bool

// Release describes one published BySpace release and its downloadable assets.
type Release struct {
	Version string           `json:"version"` // "0.22.0", no leading v
	Notes   string           `json:"notes"`
	URL     string           `json:"url"`
	Assets  map[string]Asset `json:"assets"`
}

// Asset describes one release artifact and its expected SHA-256 checksum.
type Asset struct {
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type mirrorKey struct{}
type proxyKey struct{}
type progressKey struct{}

// WithProgress attaches a byte-level download progress callback to ctx.
func WithProgress(ctx context.Context, fn func(done, total int64)) context.Context {
	if fn == nil {
		return ctx
	}
	return context.WithValue(ctx, progressKey{}, fn)
}

type progressReader struct {
	r     io.Reader
	done  int64
	total int64
	fn    func(done, total int64)
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.r.Read(buf)
	if n > 0 {
		p.done += int64(n)
		if p.fn != nil {
			p.fn(p.done, p.total)
		}
	}
	return n, err
}

// WithMirror routes GitHub release downloads under ctx through the mirror prefix
// (e.g. "https://mirror.example/https://github.com/..."). Checksums are still verified
// against the authoritative SHA256SUMS.
func WithMirror(ctx context.Context, prefix string) context.Context {
	if prefix = strings.TrimSpace(prefix); prefix == "" {
		return ctx
	}
	return context.WithValue(ctx, mirrorKey{}, prefix)
}

// Mirror returns the mirror prefix configured on ctx or via BYSPACE_MIRROR.
func Mirror(ctx context.Context) string {
	m, _ := ctx.Value(mirrorKey{}).(string)
	if m == "" {
		m = strings.TrimSpace(os.Getenv("BYSPACE_MIRROR"))
	}
	if m == "off" || m == "direct" {
		return ""
	}
	return m
}

// CheckMirror validates an HTTP(S) GitHub download mirror prefix.
func CheckMirror(prefix string) error {
	u, err := url.Parse(strings.TrimSpace(prefix))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("a mirror is an http(s) address put before the github.com URL, like https://mirror.example/, not %q", prefix)
	}
	return nil
}

// WithProxy routes update requests under ctx through the given proxy URL.
func WithProxy(ctx context.Context, proxy string) context.Context {
	if proxy = strings.TrimSpace(proxy); proxy == "" {
		return ctx
	}
	return context.WithValue(ctx, proxyKey{}, proxy)
}

// Proxy returns the proxy URL configured on ctx or via BYSPACE_PROXY.
func Proxy(ctx context.Context) string {
	p, _ := ctx.Value(proxyKey{}).(string)
	if p == "" {
		p = strings.TrimSpace(os.Getenv("BYSPACE_PROXY"))
	}
	return p
}

// CheckProxy validates a proxy URL (http, https, socks5, socks5h).
func CheckProxy(proxy string) error {
	proxy = strings.TrimSpace(proxy)
	if proxy == "" || proxy == "direct" {
		return nil
	}
	if !strings.Contains(proxy, "://") {
		proxy = "http://" + proxy
	}
	u, err := url.Parse(proxy)
	if err != nil || u.Host == "" {
		return fmt.Errorf("a proxy is an address like http://127.0.0.1:7890 or socks5://127.0.0.1:1080, not %q", proxy)
	}
	switch u.Scheme {
	case "http", "https", "socks5", "socks5h":
		return nil
	default:
		return fmt.Errorf("a proxy is http://, https://, socks5:// or socks5h://, not %q", proxy)
	}
}

func httpClientFor(ctx context.Context, timeout time.Duration) *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if p := Proxy(ctx); p != "" {
		if p == "direct" {
			tr.Proxy = nil
		} else {
			if !strings.Contains(p, "://") {
				p = "http://" + p
			}
			if u, err := url.Parse(p); err == nil {
				tr.Proxy = http.ProxyURL(u)
			}
		}
	}
	return &http.Client{Timeout: timeout, Transport: tr}
}

func mirroredURL(prefix, raw string) string {
	if prefix == "" {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	h := strings.ToLower(u.Hostname())
	if h != "github.com" && !strings.HasSuffix(h, ".github.com") && !strings.HasSuffix(h, ".githubusercontent.com") {
		return raw
	}
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	return prefix + raw
}

var describeRe = regexp.MustCompile(`^\d+-g[0-9a-f]+`)

// Released reports whether v is a release version rather than a source build ("dev", "dirty", etc.).
func Released(v string) bool {
	s := parseSemver(v)
	return s != nil && !describeRe.MatchString(s.pre) && !strings.Contains(s.pre, "dirty")
}

// Newer reports whether version a is newer than version b according to SemVer 2.0.
func Newer(a, b string) bool {
	x, y := parseSemver(a), parseSemver(b)
	if x == nil || y == nil {
		return false
	}
	for i := range 3 {
		if x.n[i] != y.n[i] {
			return x.n[i] > y.n[i]
		}
	}
	return comparePre(x.pre, y.pre) > 0
}

func comparePre(a, b string) int {
	switch {
	case a == b:
		return 0
	case a == "":
		return 1
	case b == "":
		return -1
	}
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(x) && i < len(y); i++ {
		m, errM := strconv.ParseUint(x[i], 10, 64)
		n, errN := strconv.ParseUint(y[i], 10, 64)
		switch {
		case errM == nil && errN == nil:
			if m != n {
				return cmp.Compare(m, n)
			}
		case errM == nil:
			return -1
		case errN == nil:
			return 1
		default:
			if c := strings.Compare(x[i], y[i]); c != 0 {
				return c
			}
		}
	}
	return cmp.Compare(len(x), len(y))
}

type semver struct {
	n   [3]int
	pre string
}

func parseSemver(v string) *semver {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	v, _, _ = strings.Cut(v, "+")
	v, pre, _ := strings.Cut(v, "-")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return nil
	}
	var s semver
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil
		}
		s.n[i] = n
	}
	s.pre = pre
	return &s
}

// AppAsset returns the macOS .app zip asset name for the current architecture.
func AppAsset() string {
	return "byspace-darwin-" + runtime.GOARCH + ".zip"
}

// BinaryAsset returns the release binary name for this build and platform.
func BinaryAsset() string {
	name := "byspace-cli-" + runtime.GOOS + "-" + runtime.GOARCH
	if GUI && runtime.GOOS != "darwin" {
		name = "byspace-" + runtime.GOOS + "-" + runtime.GOARCH
	}
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// LegacyBinaryAsset returns the fallback bare binary name ("byspace-<os>-<arch>").
func LegacyBinaryAsset() string {
	name := "byspace-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// APKAsset returns the Android APK asset name.
func APKAsset() string {
	return "byspace-android-arm64.apk"
}

// Bundle returns the enclosing macOS .app path when the running binary (or symlink target)
// lives inside Contents/MacOS/<exe>, or "" otherwise.
func Bundle() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	exe, err := Executable()
	if err != nil {
		return ""
	}
	return BundleOf(exe)
}

// BundleOf extracts the enclosing .app path from a binary path if it resides in Contents/MacOS.
func BundleOf(exe string) string {
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if !strings.EqualFold(filepath.Ext(app), ".app") || filepath.Base(filepath.Dir(exe)) != "MacOS" {
		return ""
	}
	return app
}

// Executable returns the running binary path with symlinks resolved.
func Executable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, evalErr := filepath.EvalSymlinks(exe); evalErr == nil {
		return resolved, nil
	}
	return exe, nil
}

// Writable reports whether dir can be written to by the current user.
func Writable(dir string) bool {
	return writableReason(dir+"/dummy") == ""
}

// Latest fetches metadata and SHA-256 checksums for the latest published release.
// Supports BYSPACE_UPDATE_FEED (JSON feed override) or GitHub Releases (API + 302 redirect fallback).
func Latest(ctx context.Context) (*Release, error) {
	if feedURL := strings.TrimSpace(os.Getenv("BYSPACE_UPDATE_FEED")); feedURL != "" {
		return latestFromFeedURL(ctx, feedURL)
	}
	if rel, err := latestFromGitHubAPI(ctx); err == nil && rel != nil {
		return rel, nil
	}
	return latestFromGitHubRedirect(ctx)
}

func latestFromFeedURL(ctx context.Context, feedURL string) (*Release, error) {
	client := httpClientFor(ctx, 30*time.Second)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update feed: %s", resp.Status)
	}
	var rel Release
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("update feed: %w", err)
	}
	rel.Version = strings.TrimPrefix(strings.TrimSpace(rel.Version), "v")
	if parseSemver(rel.Version) == nil {
		return nil, errors.New("update feed: invalid or missing version")
	}
	return &rel, nil
}

func latestFromGitHubAPI(ctx context.Context) (*Release, error) {
	client := httpClientFor(ctx, 30*time.Second)
	apiURL := "https://api.github.com/repos/" + Repo + "/releases/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "byspace-updater")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api: %s", resp.Status)
	}
	var gh struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&gh); err != nil {
		return nil, err
	}
	tag := strings.TrimSpace(gh.TagName)
	version := strings.TrimPrefix(tag, "v")
	if parseSemver(version) == nil {
		return nil, fmt.Errorf("github api: invalid tag %q", tag)
	}
	sums, _ := fetchChecksums(ctx, tag)
	rel := &Release{
		Version: version,
		Notes:   gh.Body,
		URL:     gh.HTMLURL,
		Assets:  make(map[string]Asset),
	}
	for _, a := range gh.Assets {
		if a.Name == "SHA256SUMS" || a.Name == "SHA256SUMS.txt" || strings.HasSuffix(a.Name, ".sha256") {
			continue
		}
		rel.Assets[a.Name] = Asset{
			URL:    a.BrowserDownloadURL,
			Size:   a.Size,
			SHA256: sums[a.Name],
		}
	}
	return rel, nil
}

func latestFromGitHubRedirect(ctx context.Context) (*Release, error) {
	client := httpClientFor(ctx, 30*time.Second)
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	latestPage := "https://github.com/" + Repo + "/releases/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestPage, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "byspace-updater")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	loc := resp.Header.Get("Location")
	_, tag, ok := strings.Cut(loc, "/tag/")
	if !ok || tag == "" {
		return nil, fmt.Errorf("could not resolve latest release from %s (status %d)", latestPage, resp.StatusCode)
	}
	tag = strings.TrimSpace(tag)
	version := strings.TrimPrefix(tag, "v")
	if parseSemver(version) == nil {
		return nil, fmt.Errorf("invalid release tag %q", tag)
	}
	sums, err := fetchChecksums(ctx, tag)
	if err != nil {
		return nil, err
	}
	base := releaseBaseURL()
	rel := &Release{
		Version: version,
		URL:     "https://github.com/" + Repo + "/releases/tag/" + tag,
		Assets:  make(map[string]Asset, len(sums)),
	}
	for name, sha := range sums {
		rel.Assets[name] = Asset{
			URL:    base + "/" + tag + "/" + name,
			SHA256: sha,
		}
	}
	return rel, nil
}

func fetchChecksums(ctx context.Context, tag string) (map[string]string, error) {
	client := httpClientFor(ctx, 30*time.Second)
	base := releaseBaseURL()
	for _, sumName := range []string{"SHA256SUMS", "SHA256SUMS.txt"} {
		u := base + "/" + tag + "/" + sumName
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK && readErr == nil {
			parsed := ParseChecksums(string(body))
			if len(parsed) > 0 {
				return parsed, nil
			}
		}
	}
	return nil, fmt.Errorf("release %s has no SHA256SUMS", tag)
}

// ParseChecksums parses standard sha256sum / shasum output ("<64-hex>  <filename>").
func ParseChecksums(text string) map[string]string {
	out := make(map[string]string)
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		sum := strings.ToLower(fields[0])
		if len(sum) != 64 {
			continue
		}
		name := filepath.Base(strings.TrimPrefix(fields[1], "*"))
		out[name] = sum
	}
	return out
}

// ResolveBinaryAsset picks the matching binary Asset for the current platform from rel.
func ResolveBinaryAsset(rel *Release) (string, Asset, error) {
	if rel == nil {
		return "", Asset{}, errors.New("nil release")
	}
	for _, candidate := range []string{BinaryAsset(), LegacyBinaryAsset()} {
		if a, ok := rel.Assets[candidate]; ok {
			return candidate, a, nil
		}
	}
	return "", Asset{}, fmt.Errorf("release %s has no %s", rel.Version, BinaryAsset())
}

var retryWaits = []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second}

type netDownloadError struct {
	file string
	err  error
}

func (e *netDownloadError) Error() string {
	return fmt.Sprintf("download of %s interrupted (%v)", e.file, e.err)
}

func (e *netDownloadError) Unwrap() error { return e.err }

func isNetDownloadError(err error) bool {
	var ne *netDownloadError
	return errors.As(err, &ne)
}

type readErrTracker struct {
	r   io.Reader
	err error
}

func (r *readErrTracker) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	if err != nil && err != io.EOF {
		r.err = err
	}
	return n, err
}

func fileSHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

// DownloadAsset downloads a to destPath (with Range resume across transient network drops,
// ported from magpie's download/fetch) and verifies its SHA-256 over the whole file.
func DownloadAsset(ctx context.Context, a Asset, destPath string) error {
	if a.SHA256 == "" {
		return fmt.Errorf("release lists no SHA-256 checksum for %s", filepath.Base(destPath))
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	_ = os.Remove(destPath)
	var err error
	for try := 0; try <= len(retryWaits); try++ {
		if try > 0 {
			select {
			case <-ctx.Done():
				_ = os.Remove(destPath)
				return err
			case <-time.After(retryWaits[try-1]):
			}
		}
		if err = fetchAssetAttempt(ctx, a, destPath); err == nil || ctx.Err() != nil || !isNetDownloadError(err) {
			break
		}
	}
	if err != nil {
		_ = os.Remove(destPath)
		return err
	}
	if err := os.Chmod(destPath, 0o755); err != nil {
		_ = os.Remove(destPath)
		return err
	}
	return nil
}

func fetchAssetAttempt(ctx context.Context, a Asset, destPath string) error {
	client := httpClientFor(ctx, 10*time.Minute)
	targetURL := mirroredURL(Mirror(ctx), a.URL)
	name := filepath.Base(destPath)

	var have int64
	if fi, err := os.Stat(destPath); err == nil && fi.Mode().IsRegular() {
		have = fi.Size()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return err
	}
	if have > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", have))
	}
	fail := func(err error) error {
		if !isNetDownloadError(err) {
			_ = os.Remove(destPath)
		}
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return fail(err)
		}
		return fail(&netDownloadError{file: name, err: err})
	}
	defer resp.Body.Close()

	flags := os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	switch {
	case resp.StatusCode == http.StatusPartialContent && have > 0 && strings.HasPrefix(resp.Header.Get("Content-Range"), fmt.Sprintf("bytes %d-", have)):
		flags = os.O_WRONLY | os.O_APPEND
	case resp.StatusCode == http.StatusOK:
		have = 0
	default:
		return fail(fmt.Errorf("download %s returned HTTP %d", name, resp.StatusCode))
	}

	f, err := os.OpenFile(destPath, flags, 0o644)
	if err != nil {
		return fail(err)
	}
	in := &readErrTracker{r: resp.Body}
	var body io.Reader = in
	if fn, _ := ctx.Value(progressKey{}).(func(int64, int64)); fn != nil {
		total := resp.ContentLength
		if total > 0 {
			total += have
		} else {
			total = a.Size
		}
		if total < 0 {
			total = 0
		}
		fn(have, total)
		body = &progressReader{r: in, done: have, total: total, fn: fn}
	}
	_, copyErr := io.Copy(f, body)
	if closeErr := f.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		if ctx.Err() == nil && in.err != nil {
			copyErr = &netDownloadError{file: name, err: copyErr}
		}
		return fail(copyErr)
	}

	got := fileSHA256(destPath)
	if !strings.EqualFold(got, a.SHA256) {
		return fail(fmt.Errorf("SHA-256 mismatch for %s (got %s, want %s)", name, got, a.SHA256))
	}
	return nil
}

// StageBinary downloads and verifies the release binary next to exe (as exe + ".new").
func StageBinary(ctx context.Context, rel *Release, exe string) (string, error) {
	if exe == "" {
		var err error
		exe, err = Executable()
		if err != nil {
			return "", err
		}
	}
	_, asset, err := ResolveBinaryAsset(rel)
	if err != nil {
		return "", err
	}
	staged := exe + ".new"
	if err := DownloadAsset(ctx, asset, staged); err != nil {
		return "", err
	}
	return staged, nil
}

const (
	errSharingViolation syscall.Errno = 32
	errLockViolation    syscall.Errno = 33
)

var asideWaits = []time.Duration{
	100 * time.Millisecond,
	200 * time.Millisecond,
	400 * time.Millisecond,
	800 * time.Millisecond,
	1500 * time.Millisecond,
}

var heldFor = 30 * time.Second

func waitHeld(i int, err error, start time.Time, retry bool) bool {
	if !retry {
		return false
	}
	if i < len(asideWaits) {
		time.Sleep(asideWaits[i])
		return true
	}
	if !heldOpen(err) || len(asideWaits) == 0 {
		return false
	}
	pause := asideWaits[len(asideWaits)-1]
	if time.Since(start)+pause > heldFor {
		return false
	}
	time.Sleep(pause)
	return true
}

func moveIn(from, exe string) error {
	start := time.Now()
	for i := 0; ; i++ {
		err := os.Rename(from, exe)
		if err == nil || !waitHeld(i, err, start, heldOpen(err)) {
			return err
		}
	}
}

func heldOpen(err error) bool {
	return errors.Is(err, errSharingViolation) || errors.Is(err, errLockViolation)
}

// Replaced reports whether exe on disk is no longer the binary that was present when this
// process started (ported from magpie's update.Replaced).
func Replaced(exe string, started os.FileInfo) bool {
	now, err := os.Stat(exe)
	return err == nil && started != nil && (now.Size() != started.Size() || !now.ModTime().Equal(started.ModTime()))
}

// RemoveStaleNew removes exe.new when its hash matches the already-running exe.
func RemoveStaleNew(exe string) {
	staged := exe + ".new"
	a, err1 := os.Stat(exe)
	b, err2 := os.Stat(staged)
	if err1 != nil || err2 != nil || a.Size() != b.Size() {
		return
	}
	if ha, hb := fileSHA256(exe), fileSHA256(staged); ha != "" && ha == hb {
		_ = os.Remove(staged)
	}
}

// RemoveOld cleans up any leftover .old binaries and interrupted .byspace-dl-*
// temp files from earlier updates.
func RemoveOld(exe string) {
	if exe == "" {
		return
	}
	_ = os.Remove(exe + ".old")
	olds, _ := filepath.Glob(exe + ".old-*")
	for _, o := range olds {
		_ = os.Remove(o)
	}
	dir := filepath.Dir(exe)
	for _, pat := range []string{".byspace-dl-*", ".byspace-new-*"} {
		leftovers, _ := filepath.Glob(filepath.Join(dir, pat))
		for _, f := range leftovers {
			_ = os.Remove(f)
		}
	}
}

func moveAside(exe string) (string, error) {
	name := exe + ".old"
	for n := 2; ; n++ {
		if _, err := os.Lstat(name); os.IsNotExist(err) {
			break
		}
		name = fmt.Sprintf("%s.old-%d", exe, n)
	}
	var err error
	for i := 0; ; i++ {
		if err = os.Rename(exe, name); err == nil {
			return name, nil
		}
		if errors.Is(err, fs.ErrNotExist) || i == len(asideWaits) {
			break
		}
		time.Sleep(asideWaits[i])
	}
	return "", fmt.Errorf("could not move running executable %s aside: %w", filepath.Base(exe), err)
}

// InstallBinary swaps a staged binary into place at exe, waiting up to heldFor on Windows when
// an antivirus scanner holds the new download open and restoring from .old on failure (ported
// from magpie's InstallBinaryAside).
func InstallBinary(staged, exe string) error {
	if err := os.Rename(staged, exe); err == nil {
		return nil
	} else if runtime.GOOS != "windows" {
		return err
	}

	RemoveOld(exe)
	var old string
	if _, statErr := os.Stat(exe); statErr == nil {
		var err error
		if old, err = moveAside(exe); err != nil {
			return err
		}
	}
	if err := moveIn(staged, exe); err != nil {
		if old != "" {
			_ = moveIn(old, exe)
		}
		return err
	}
	return nil
}

// StageApp downloads and unpacks the macOS BySpace.app bundle next to bundle.
func StageApp(ctx context.Context, rel *Release, bundle string) (string, error) {
	asset, ok := rel.Assets[AppAsset()]
	if !ok {
		return "", fmt.Errorf("release %s has no %s", rel.Version, AppAsset())
	}
	dir := filepath.Join(filepath.Dir(bundle), ".byspace-update")
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	zipPath := filepath.Join(dir, AppAsset())
	if err := DownloadAsset(ctx, asset, zipPath); err != nil {
		_ = os.RemoveAll(dir)
		return "", err
	}
	outDir := filepath.Join(dir, "app")
	if b, err := exec.CommandContext(ctx, "ditto", "-x", "-k", zipPath, outDir).CombinedOutput(); err != nil {
		_ = os.RemoveAll(dir)
		return "", fmt.Errorf("unzip %s: %v: %s", AppAsset(), err, strings.TrimSpace(string(b)))
	}
	_ = os.Remove(zipPath)
	for _, candidate := range []string{"BySpace.app", "byspace.app"} {
		p := filepath.Join(outDir, candidate)
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			return p, nil
		}
	}
	_ = os.RemoveAll(dir)
	return "", fmt.Errorf("archive %s did not contain BySpace.app", AppAsset())
}

// InstallApp atomically swaps the staged .app bundle in for bundle.
func InstallApp(staged, bundle string) error {
	old := filepath.Join(filepath.Dir(staged), "old.app")
	_ = os.RemoveAll(old)
	if err := os.Rename(bundle, old); err != nil {
		return err
	}
	if err := os.Rename(staged, bundle); err != nil {
		_ = os.Rename(old, bundle)
		return err
	}
	_ = os.RemoveAll(filepath.Dir(filepath.Dir(staged)))
	return nil
}

var openWaits = []string{"0.5", "1", "1", "2", "2", "3", "4"}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func relaunchLogPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		return os.DevNull
	}
	dir := filepath.Join(homeDir, ".byspace")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return os.DevNull
	}
	p := filepath.Join(dir, "relaunch.log")
	if fi, err := os.Stat(p); err == nil && fi.Size() > 64<<10 {
		_ = os.Rename(p, p+".old")
	}
	return p
}

// BuildRelaunchScript builds the shell command that reopens bundle after the parent pid exits
// (ported from magpie's relaunchScript):
//   - uses `open -n` so LaunchServices does not send a reopen event to the dying process (-600 procNotFound);
//   - retries across waits (~13.5s total);
//   - falls back to exec'ing Contents/MacOS/byspace directly when LaunchServices refuses `open`
//     (e.g. during an idle auto-update while the macOS screen is locked).
func BuildRelaunchScript(bundle string, showWindow bool, logFile string, waits []string) string {
	if logFile == "" {
		logFile = os.DevNull
	}
	exe := filepath.ToSlash(filepath.Join(bundle, "Contents", "MacOS", "byspace"))
	run := shellQuote(exe)
	openCmd := "open -n " + shellQuote(bundle)
	if !showWindow {
		run += " 'tray'"
		openCmd += " --args 'tray'"
	}
	var b strings.Builder
	b.WriteString("log=" + shellQuote(logFile) + "; ")
	b.WriteString(`note() { echo "$(date '+%Y-%m-%d %H:%M:%S %z') $*" >> "$log" 2>/dev/null; }; `)
	b.WriteString(`try() { n=$((n+1)); e=$(` + openCmd + ` 2>&1 >/dev/null); s=$?; note "open try $n: exit $s $(printf '%s' "$e" | tr '\n' ' ')"; return $s; }; `)
	b.WriteString("n=0; note " + shellQuote("byspace has exited; opening "+bundle) + "; ")
	if len(waits) == 0 {
		b.WriteString("try")
	} else {
		b.WriteString(fmt.Sprintf("for w in %s; do try && exit 0; sleep $w; done; try", strings.Join(waits, " ")))
	}
	b.WriteString(` || { note "open gave up after $n tries; starting ` + exe + `"; `)
	b.WriteString("[ -x " + shellQuote(exe) + " ] || exit 1; ")
	b.WriteString("exec " + run + " </dev/null >/dev/null 2>&1; }")
	return b.String()
}

// RelaunchApp reopens a macOS .app bundle in its own detached session after the current process exits.
func RelaunchApp(bundle string, showWindow bool) error {
	inner := BuildRelaunchScript(bundle, showWindow, relaunchLogPath(), openWaits)
	script := fmt.Sprintf("while kill -0 %d 2>/dev/null; do sleep 0.2; done; %s", os.Getpid(), inner)
	cmd := exec.Command("/bin/sh", "-c", script)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	detachProcess(cmd)
	return cmd.Start()
}

// EnsureAppCLISymlink links ~/.local/bin/byspace to the running macOS .app bundle's binary
// when the user installed BySpace.app via .dmg drag-and-drop and ~/.local/bin/byspace is either
// absent or already a symlink. If force is true, a standalone regular file at ~/.local/bin/byspace
// is also replaced with the symlink.
func EnsureAppCLISymlink(force bool) (linkedPath string, ok bool) {
	if runtime.GOOS != "darwin" {
		return "", false
	}
	bundle := Bundle()
	if bundle == "" {
		return "", false
	}
	return EnsureBundleCLISymlink(bundle, "", force)
}

// EnsureBundleCLISymlink links binDir/byspace to bundle/Contents/MacOS/byspace.
func EnsureBundleCLISymlink(bundle, binDir string, force bool) (string, bool) {
	if bundle == "" {
		return "", false
	}
	target := filepath.Join(bundle, "Contents", "MacOS", "byspace")
	if _, err := os.Stat(target); err != nil {
		return "", false
	}
	if binDir == "" {
		binDir = strings.TrimSpace(os.Getenv("BYSPACE_BIN_DIR"))
	}
	if binDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil || homeDir == "" {
			return "", false
		}
		binDir = filepath.Join(homeDir, ".local", "bin")
	}
	linkPath := filepath.Join(binDir, "byspace")
	if st, err := os.Lstat(linkPath); err == nil {
		if st.Mode()&os.ModeSymlink != 0 {
			if dest, readErr := os.Readlink(linkPath); readErr == nil && dest == target {
				return linkPath, true
			}
		} else if !force {
			return linkPath, false
		}
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", false
	}
	tmpLink := linkPath + ".tmp-link"
	_ = os.Remove(tmpLink)
	if err := os.Symlink(target, tmpLink); err != nil {
		return "", false
	}
	if err := os.Rename(tmpLink, linkPath); err != nil {
		_ = os.Remove(tmpLink)
		return "", false
	}
	return linkPath, true
}

// RelaunchBinary spawns the updated binary with BYSPACE_REPLACES=<pid>.
func RelaunchBinary(exe string, showWindow bool) error {
	args := []string{"app"}
	if !showWindow {
		args = []string{"tray"}
	}
	cmd := exec.Command(exe, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	detachProcess(cmd)
	cmd.Env = append(os.Environ(), "BYSPACE_REPLACES="+strconv.Itoa(os.Getpid()))
	return cmd.Start()
}

// AwaitPredecessor waits up to 15s for the process named in BYSPACE_REPLACES to exit
// before acquiring SingleInstance or binding ports, then cleans up any .old binary.
func AwaitPredecessor() {
	pid, err := strconv.Atoi(os.Getenv("BYSPACE_REPLACES"))
	_ = os.Unsetenv("BYSPACE_REPLACES")
	if err != nil || pid <= 0 {
		return
	}
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); {
		if !processAlive(pid) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if exe, exeErr := Executable(); exeErr == nil && exe != "" {
		RemoveOld(exe)
	}
}

// CopiedCLI returns the path of ~/.local/bin/byspace on macOS when it is a standalone regular file
// rather than a symlink into BySpace.app.
func CopiedCLI() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	bin := strings.TrimSpace(os.Getenv("BYSPACE_BIN_DIR"))
	if bin == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return ""
		}
		bin = filepath.Join(home, ".local", "bin")
	}
	cliPath := filepath.Join(bin, "byspace")
	st, err := os.Lstat(cliPath)
	if err != nil || !st.Mode().IsRegular() {
		return ""
	}
	return cliPath
}
