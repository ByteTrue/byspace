package tunnel

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/coder/websocket"
)

// TunnelReconnector maintains the initiator's connection to a peer daemon through a relay.
//
// Ported from the reconnect block of tunnel-manager.ts. The daemon previously only ever played
// the server role on a relay — it serves browsers — so the client half of the v2 protocol did not
// exist in Go. A tunnel inverts that: the initiator dials the target's serverId as a client, the
// relay pairs it with the target's server-data socket, and the E2EE handshake runs over the
// resulting pipe.
//
// The protocol, from the relay's side (internal/relay/relay.go):
//   - a `role=client` socket is tagged `client:<connectionId>`;
//   - the relay notifies the target's `server-control` socket with {type: connected, connectionId};
//   - the target opens `role=server&connectionId=<cid>`, and frames are then forwarded between the
//     two tagged sockets.
//
// So the initiator only opens one socket and waits: the relay does the pairing.
type TunnelReconnector struct {
	// RelayURL is the base ws(s) URL of the relay, without query parameters.
	RelayURL string
	// PeerServerID is the target daemon's server id, from the pairing offer.
	PeerServerID string
	// PeerPublicKey is the target's E2EE public key, base64. Empty disables E2EE, which is only
	// correct for a loopback relay.
	PeerPublicKey string
	// Token is the daemon password, sent as `byspace.bearer.<token>`.
	Token string
	// ClientID identifies this initiator in relay logs.
	ClientID string

	// OnPeer receives each connection: the caller attaches it to a Manager.
	OnPeer func(PeerConn)
	// OnState reports connected/disconnected so the manager can update port states.
	OnState func(state string)

	Logf func(string, ...any)

	// BaseDelay and MaxDelay bound the reconnect backoff. Zero means the defaults.
	BaseDelay time.Duration
	MaxDelay  time.Duration
}

const (
	defaultReconnectBaseDelay = 500 * time.Millisecond
	defaultReconnectMaxDelay  = 30 * time.Second
)

// Run connects and reconnects until ctx is cancelled.
func (r *TunnelReconnector) Run(ctx context.Context) {
	if r.Logf == nil {
		r.Logf = func(string, ...any) {}
	}
	base := r.BaseDelay
	if base <= 0 {
		base = defaultReconnectBaseDelay
	}
	maxDelay := r.MaxDelay
	if maxDelay <= 0 {
		maxDelay = defaultReconnectMaxDelay
	}

	delay := base
	for {
		if ctx.Err() != nil {
			return
		}
		err := r.connectOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if r.OnState != nil {
			r.OnState(StateDisconnected)
		}
		if err != nil {
			r.Logf("tunnel %s: connection ended: %v", r.PeerServerID, err)
		}

		// Linear-then-capped backoff, matching the node client: a relay restart comes back in
		// seconds, and a longer outage should not hammer it.
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay *= 2
		if delay > maxDelay {
			delay = maxDelay
		}
	}
}

// connectOnce runs one connection lifetime.
func (r *TunnelReconnector) connectOnce(ctx context.Context) error {
	wsURL, err := r.clientURL()
	if err != nil {
		return err
	}

	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	var header map[string][]string
	if token := strings.TrimSpace(r.Token); token != "" {
		// The daemon password travels as a subprotocol because a browser cannot set an
		// Authorization header on a WebSocket; the server-side check already accepts this form.
		header = map[string][]string{"Sec-WebSocket-Protocol": {"byspace.bearer." + token}}
	}

	ws, _, err := websocket.Dial(dialCtx, wsURL, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		return fmt.Errorf("cannot reach relay: %w", err)
	}
	defer ws.CloseNow()
	ws.SetReadLimit(64 * 1024 * 1024)

	raw := &relayTransport{ctx: ctx, ws: ws}

	var session *e2ee.ClientSession
	if key := strings.TrimSpace(r.PeerPublicKey); key != "" {
		peerKey, keyErr := e2ee.ImportKey(key)
		if keyErr != nil {
			return fmt.Errorf("invalid peer public key: %w", keyErr)
		}
		// A per-connection key: the tunnel is a runtime relationship, not an identity, so nothing
		// is gained by persisting it and something is lost if it is reused.
		localKey, keyErr := e2ee.GenerateKeyPair()
		if keyErr != nil {
			return keyErr
		}
		session = e2ee.NewClientSession(raw, localKey)
		if beginErr := session.Begin(peerKey); beginErr != nil {
			return beginErr
		}
	}

	conn := &relayPeer{
		transport: raw,
		session:   session,
		frames:    make(chan Frame, 64),
		done:      make(chan struct{}),
		logf:      r.Logf,
	}
	go conn.readLoop()

	if r.OnState != nil {
		r.OnState(StateConnected)
	}
	if r.OnPeer != nil {
		r.OnPeer(conn)
	}

	<-conn.done
	return conn.err
}

// clientURL builds the relay URL for the initiator role.
func (r *TunnelReconnector) clientURL() (string, error) {
	if strings.TrimSpace(r.PeerServerID) == "" {
		return "", errors.New("tunnel needs a peer serverId")
	}
	u, err := url.Parse(r.RelayURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("serverId", r.PeerServerID)
	q.Set("role", "client")
	q.Set("v", "2")
	if strings.TrimSpace(r.ClientID) != "" {
		q.Set("clientId", r.ClientID)
	}
	u.RawQuery = q.Encode()
	// Set by hand: url.Encode escapes nothing here, but the relay rejects an empty v or role and
	// silently 404s on a path it does not recognise, which is a much worse error to debug than a
	// 400 with a reason.
	u.Path = "/ws"
	return u.String(), nil
}

// relayTransport adapts a websocket to e2ee.Transport.
type relayTransport struct {
	ctx context.Context
	ws  *websocket.Conn
}

func (t *relayTransport) SendText(text string) error {
	return t.ws.Write(t.ctx, websocket.MessageText, []byte(text))
}

func (t *relayTransport) SendBinary(data []byte) error {
	return t.ws.Write(t.ctx, websocket.MessageBinary, data)
}

func (t *relayTransport) Close(code int, reason string) error {
	return t.ws.Close(websocket.StatusCode(code), reason)
}

// relayPeer is the PeerConn backed by a relay websocket.
type relayPeer struct {
	transport *relayTransport
	session   *e2ee.ClientSession

	frames chan Frame
	done   chan struct{}
	once   sync.Once
	err    error
	logf   func(string, ...any)
}

// readLoop decrypts inbound frames and delivers them.
func (p *relayPeer) readLoop() {
	defer p.finish(nil)

	for {
		msgType, data, err := p.transport.ws.Read(p.transport.ctx)
		if err != nil {
			p.finish(err)
			return
		}

		rawFrame := e2ee.Frame{Data: data, IsBinary: msgType == websocket.MessageBinary}
		var plain *e2ee.Frame
		var decErr error
		if p.session != nil {
			plain, decErr = p.session.Receive(rawFrame)
			if decErr != nil {
				p.finish(decErr)
				return
			}
			if plain == nil {
				// Handshake traffic; nothing to deliver.
				continue
			}
		} else {
			plain = &rawFrame
		}

		if plain.IsBinary {
			frame, ok := DecodeFrame(plain.Data)
			if !ok {
				// Not a tunnel frame. The relay forwards whatever the peer sends, so a foreign
				// frame is a protocol error worth reporting once rather than ignoring forever.
				p.logf("tunnel: peer sent a frame that is not a tunnel frame")
				continue
			}
			select {
			case p.frames <- frame:
			case <-p.done:
				return
			}
		}
	}
}

// finish closes the frame channel exactly once.
func (p *relayPeer) finish(err error) {
	p.once.Do(func() {
		if err != nil && !errors.Is(err, context.Canceled) {
			p.err = err
		}
		close(p.frames)
		close(p.done)
	})
}

func (p *relayPeer) Send(frame Frame) error {
	select {
	case <-p.done:
		return ErrPeerClosed
	default:
	}
	encoded, err := EncodeFrame(frame.Opcode, frame.TunnelID, frame.Payload)
	if err != nil {
		return err
	}
	if p.session != nil {
		if sendErr := p.session.Send(e2ee.Frame{Data: encoded, IsBinary: true}); sendErr != nil {
			return sendErr
		}
		return nil
	}
	return p.transport.SendBinary(encoded)
}

func (p *relayPeer) Frames() <-chan Frame { return p.frames }
func (p *relayPeer) Err() error           { return p.err }

func (p *relayPeer) Close() error {
	p.finish(nil)
	return p.transport.ws.Close(websocket.StatusNormalClosure, "")
}
