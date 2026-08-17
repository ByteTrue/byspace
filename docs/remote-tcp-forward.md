# Remote TCP Forward

Remote TCP Forward exposes one selected port from a remote BySpace daemon as a loopback port on the current daemon machine. It uses the existing Relay v2 transport and end-to-end encryption; it does not install a virtual network interface or change system networking.

## Start a forward

In the Web app, open **Port forwarding** from the left sidebar. Select two connected hosts, enter the target daemon's loopback port, optionally request an exact local port, and start the forward. The app obtains the target host's current pairing offer directly; it does not display or persist the pairing URL. Active forwards remain available while navigating elsewhere in the app and can be copied or stopped from the same page.

The CLI equivalent uses daemon B's normal v2 pairing URL from its Pair screen or `byspace daemon pair`:

Run the command on daemon A's machine:

```bash
byspace tunnel '<pairing-url>' 3000
```

The command prints the actual endpoint, for example:

```text
127.0.0.1:3000 -> daemon-b:127.0.0.1:3000
Press Ctrl-C to stop.
```

Use that local endpoint with the normal client:

```bash
curl http://127.0.0.1:3000/api/health
```

If local port `3000` is already in use, BySpace selects an available loopback port and prints it. Request an exact source port with:

```bash
byspace tunnel '<pairing-url>' 3000 --local-port 43000
```

`--json` or `--format yaml` prints the same endpoint as one structured object. The command remains in the foreground because it owns the forward; `Ctrl-C`, daemon-control disconnect, or daemon shutdown closes the listener and its active streams.

## Data path

```text
local client
  -> daemon A 127.0.0.1:<localPort>
  -> Relay v2 E2EE data connection
  -> daemon B loopback:<targetPort>
  -> remote service
```

Each accepted local TCP connection gets one Relay/E2EE data connection. Payload is forwarded as bytes without HTTP parsing, TLS termination, HTML rewriting, or Cookie handling. This supports HTTP, HTTPS, WebSocket, development HMR, and other TCP protocols through the same path.

The bridge preserves TCP half-close. DATA frames are bounded and acknowledged only after the destination socket accepts the write, so a slow receiver applies backpressure instead of causing unbounded intermediary buffering.

## Authority and security

- Daemon A binds only `127.0.0.1`; the forward is not exposed to the local LAN.
- Daemon B can dial only its own `127.0.0.1` or `::1` at the requested port. The request cannot name a LAN host, public host, Unix socket, or command.
- Relay routes connection metadata and encrypted frames but cannot read the forwarded TCP payload.
- The target daemon must be reachable through its configured Relay and the supplied pairing URL must contain its server ID, public key, and Relay endpoint.
- The pairing URL is the Relay trust anchor, exactly as it is for normal remote daemon control. A holder is already a trusted operator of daemon B and can use this feature without a second daemon-password exchange. Treat the URL like a password.
- The Web app selects from already configured hosts and fetches the target offer only when starting a forward. It keeps no pairing URL in form or persisted state.

## What it does not do

Remote TCP Forward does not provide a virtual IP, transparent all-port access, UDP, remote LAN routing, P2P, port discovery, persistent detached mappings, or a public listener. It does not require TUN/TAP, a privileged helper, administrator authorization, routes, DNS changes, system-proxy changes, firewall changes, or Mihomo configuration changes.
