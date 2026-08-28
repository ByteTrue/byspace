# byspace

byspace is a Web/PWA and Go daemon environment for controlling AI coding agents on one or more machines.

The project is being rebuilt from Paseo's architecture. The Web source is adapted under Apache-2.0; the daemon and CLI are being rewritten in Go.

## Web development

```bash
npm ci
npm run build:web
npm run web
```

The current icons are temporary upstream build assets and are not final byspace branding.

## Go daemon and Pi agent core

```bash
npm run build:web
(cd go && go build -o byspace ./cmd/byspace)
./go/byspace daemon start
# Remote access (or set BYSPACE_RELAY_URL):
./go/byspace daemon start --relay-url wss://relay.byspace.cc.cd
./go/byspace pair --relay-url wss://relay.byspace.cc.cd --app-url https://app.byspace.cc.cd
./go/byspace daemon status
./go/byspace agent list
./go/byspace agent timeline <agent-id> --follow
./go/byspace daemon stop
```

Import an authenticated remote daemon offer without placing its pairing secret in argv, then select it explicitly:

```bash
ssh remote-host './byspace pair' | ./go/byspace host import
./go/byspace host list
./go/byspace agent list --host <server-id>
./go/byspace agent timeline <agent-id> --host <server-id> --follow
```

`host import --file <path>` is also supported, but the source must be a private regular file (`0600` on Unix; a protected current-user ACL on Windows). Registry output never includes pairing keys or authentication tokens.

Open `http://127.0.0.1:6767` after startup. The daemon serves the copied Web app and `/ws` from the same origin, projects the canonical launch directory as a stable workspace/project, and reports local Pi availability without fabricating models or modes. Asset resolution is `--web-dir`, then `BYSPACE_WEB_DIR`, then `<daemon working directory>/packages/app/dist`; a missing Web build fails startup with an actionable error.

The daemon also provides lifecycle ownership, HTTP health/shutdown, a provider-neutral Agent/Timeline manager, and a supervised `pi --mode rpc` adapter. Agent snapshots, canonical Timeline rows, delivery idempotency, and Pi session handles are atomically persisted under `~/.byspace/state/agents-v1.json`, protected by private Unix modes or a current-user/System DACL on Windows; restarting the daemon resumes the same Pi session and preserves Agent/Timeline identity. Runtime state defaults to `~/.byspace`; use `--home` for an isolated directory. The read-only Agent CLI uses the daemon protocol rather than reading Agent state files: local commands connect through `/ws`, while `--host <server-id>` connects through a saved authenticated Relay target under `~/.byspace/state/remote-hosts-v1/`.

Relay E2EE interoperability is fixed by `fixtures/relay/e2ee-v1.json`, consumed by both copied TypeScript Relay tests and Go `internal/relay`. When `--relay-url` or `BYSPACE_RELAY_URL` is set, the daemon opens the Relay v2 control channel and serves the same Agent WebSocket contract over authenticated NaCl E2EE data channels. `byspace pair` emits a version 3 offer whose URL fragment contains the daemon public key and a 256-bit client authentication capability; Relay frames expose routing metadata but not Agent payload plaintext. Keep pairing URLs private.

The copied Web app can persist direct and authenticated Relay hosts together, switch their isolated workspaces and Agents, and automatically recover a remote host after page, Relay, or daemon restart. A production-bundle Chromium tracer verifies host-scoped outage state, direct-host continuity, canonical Timeline recovery, and Pi native-session resume against two real Go daemons and the repository's Cloudflare Wrangler Relay. The Go CLI independently imports the same v3 offer and observes remote Agent catalogs and canonical Timeline updates through the shared mutual-authenticated E2EE transport. The public `relay.byspace.cc.cd` hostname currently resolves and passes raw v2 plus full daemon/client/CLI smoke; authenticated Wrangler deployment provenance and rollout of the current admission-hardening source are still pending.

## Production Relay

`packages/relay/wrangler.toml` is the production config for `relay.byspace.cc.cd`. It disables alternate `workers.dev`/preview exposure, binds the SQLite-backed `RelayDurableObject`, and applies source/role admission rate limiting before requests reach a Durable Object.

Authenticate Wrangler outside the repository (either `npx wrangler login` or a scoped `CLOUDFLARE_API_TOKEN` in the process environment), then validate and deploy:

```bash
npx wrangler deploy --config packages/relay/wrangler.toml --dry-run
npx wrangler deploy --config packages/relay/wrangler.toml
curl -fsS https://relay.byspace.cc.cd/health
```

Run the opt-in public endpoint smoke tests after deployment. They use random Relay IDs, temporary daemon homes, and the offline fake Pi fixture:

```bash
RUN_LIVE_RELAY_E2E=1 npm test --workspace @byspace/relay -- --run src/live-relay.e2e.test.ts
RUN_LIVE_RELAY_E2E=1 npx vitest run packages/client/src/go-daemon-relay.e2e.test.ts --testNamePattern='production Relay'
```

Do not place a Cloudflare token, pairing offer, or `clientAuthTokenB64` in repository files or command arguments.

Go validation:

```bash
cd go
go vet ./...
go test -race ./...
```

Project evolution is tracked in [`codestable/`](codestable/).
