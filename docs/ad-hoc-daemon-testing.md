# Ad-hoc daemon testing

Reproduce daemon behaviour in an isolated test server without touching the main daemon on port 6777.

**Do not spawn a real daemon to reproduce something.** `byspace daemon start --home <tmp> --port <n>` is not actually isolated: it ends up binding the default listen address, so the developer's supervisor on 6777 crash-loops on `EADDRINUSE`, the temporary daemon takes over the port, the app shows empty data under a new server id, and the two `byspace.pid` files describe each other. Recovering means killing the interloper first so the real supervisor can reclaim the port; nothing is deleted, but it looks like data loss. Use an in-process Go test server, or a Vitest run, instead.

The ban is on that ad-hoc spawn, not on running a daemon. When the thing under test only exists in a real daemon — a provider binary answering, a model call failing, the browser conformance audit — run the dev daemon: `npm run dev:daemon` binds `127.0.0.1:6778` with `BYSPACE_HOME` at `.dev/byspace-home`, so it cannot collide with 6777. Drive it with `npm run cli -- run/logs/ls/inspect` and stop it when done. See [docs/development.md](development.md#running-the-dev-server).

The in-process server is for test code only. A product daemon starts through the CLI (`byspace serve`, or the supervisor that `daemon start` installs), never by constructing a `Server` directly.

## Multiple daemons and the browser (end-to-end)

Some behaviour only exists once two real daemons and a browser are in the loop: host-list sync, tunnel authorization, the pairing flow, a password gate that only a relay connection hits. Unit tests and the in-process server below run one daemon, so they cannot see it. Two real bugs in the host-sync epic — a dropped direct-connection password, and a CLI command that booted the production home — showed up only on this path.

Run it locally without touching 6777. Build the binary first (`go build -o .dev/bin/byspace.exe .`), then:

```bash
# a relay the two daemons meet on
./.dev/bin/byspace.exe relay --addr 127.0.0.1:8791 &

# two daemons, each with its own home and port, both pointed at that relay
./.dev/bin/byspace.exe serve --addr 127.0.0.1:8792 --home "$TEMP/v2a" --relay ws://127.0.0.1:8791/ws &
./.dev/bin/byspace.exe serve --addr 127.0.0.1:8793 --home "$TEMP/v2b" --relay ws://127.0.0.1:8791/ws &

# the web app, pointed at daemon A
BYSPACE_LISTEN=127.0.0.1:8792 npm run dev:app &
```

Drive the browser with the Playwright MCP server. The form fields carry `data-testid`s (`welcome-direct-connection`, `direct-password-input`, `tunnels-add-listen-host`, ...) — click and fill through those, and read state back with `page.evaluate(() => JSON.parse(localStorage.getItem('@byspace:daemon-registry')))`.

Two rules that keep this off the production home:

- **Every daemon gets its own `--home` under a temp dir and a port that is not 6777 or 6778.** `serve --addr` takes the address explicitly; `daemon start` does not, which is the spawn this doc bans.
- **Do not run `byspace pair`, `onboard`, or any CLI command that resolves a home without pointing it at the temp home.** A command that cannot reach its `--addr` falls back to reading a home, and `--home` unset resolves to `~/.byspace`. That is how `pair` once booted the production home; see [the note](../bywork/archive/v1/notes/2026-11-12-cli-pair-offline-offer-boots-the-home.md). To get a second daemon's pairing link, read `server-id` and `daemon-keypair.json` from its temp home directly, or pass `--home "$TEMP/v2b"`.

Stop the daemons and the web app when done and remove the temp homes. Confirm 6777 is still the production PID before and after.

### The relay handshake the browser actually performs

`scripts/e2e-relay-client-check.mjs` drives the shipped TypeScript relay channel (`packages/relay`) against a real daemon through a real relay. Run it after changing anything in the e2ee handshake, the relay auth path, or the binary-frame gates:

```bash
npm run build:relay
BYSPACE_HOME=$TEMP/v2a ./.dev/bin/byspace.exe relay --addr 127.0.0.1:8791 &
BYSPACE_HOME=$TEMP/v2a ./.dev/bin/byspace.exe serve --addr 127.0.0.1:8792 --home $TEMP/v2a --relay ws://127.0.0.1:8791/ws &
printf 'pw\npw\n' | ./.dev/bin/byspace.exe daemon set-password --addr 127.0.0.1:8792
E2E_HOME=$TEMP/v2a E2E_PASSWORD=pw node scripts/e2e-relay-client-check.mjs
```

It checks two things a Go test cannot see. First, the daemon's per-session e2ee challenge: the Go client answers it, so the Go relay tests keep passing while the TypeScript client stays silent and every browser frame is dropped — see [the note](../bywork/archive/v1/notes/2026-11-13-ts-relay-client-never-answered-the-e2ee-challenge.md). Second, the terminal gate: the probe sends terminal input from a socket that proved no password, and the daemon's `ws_runtime_metrics` line must keep `sessions.terminals` at 0. `E2E_SKIP_AUTH=1` leaves out the authenticated control, which is what you want on a fresh daemon; a full run ends with `terminals` at 1.

Use a fresh `connectionId` per run (the script does, from a timestamp). A reused one lets a socket left over from an earlier run receive frames meant for this one, which looks like a decryption failure.

`scripts/e2e-host-replica-check.mjs` covers the other half: start one daemon (`./.dev/bin/byspace.exe serve --addr 127.0.0.1:8792 --home $TEMP/h`) and run it with no relay. It drives `hosts.sync.exchange` through the shipped `packages/client` against that daemon and checks the record round trip: write, read back, delete leaving a tombstone, a record carrying a password refused, a carried record merged in from another replica, and the 256 KB cap. Run it after changing anything in `internal/hostsync` or the sync RPC.

## In-process test server (Go)

`newTestServer(t, homeDir)` builds a `Server` against a temp home and registers `Close` on the test's cleanup, so nothing survives the run and no port is bound until you ask for one. It lives in `internal/server/cli_credential_test.go:113`; nine test files use it.

```go
func TestSomething(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	// ... drive srv directly, or expose it over a real socket:
	ts := httptest.NewServer(srv)
	defer ts.Close()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	// websocket.Dial(ctx, wsURL, ...) — see TestWebSocketHandshakeEchoesTheBearerSubprotocol
}
```

Run one file: `go test ./internal/server -run TestSomething`. The temp home is the isolation; there is no port to collide on unless you create the `httptest` server, and that one takes an OS-assigned port.

## Gotchas

- **Provider snapshots are async.** Providers are probed in the background after start, so an early `get_providers_snapshot_request` returns `status: "loading"` for most entries. Poll until the provider you care about settles.
- **ACP providers spawn real processes.** Probing an ACP provider (e.g. Gemini with `extends: "acp"`) runs its binary, which must be installed and on PATH, and takes 5–15 seconds. Default suites use the built-in mock provider instead.
- **`fetch_agents_request` before most reads.** The session expects that handshake first; without it some requests appear to hang.
