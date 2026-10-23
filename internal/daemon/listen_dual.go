package daemon

import (
	"fmt"
	"net"
	"strconv"
	"sync"
)

// listenBothFamilies binds 127.0.0.1 and ::1 on the same port and returns a listener whose
// Accept drains both. The two sockets are independent; Accept is served from a merged channel.
func listenBothFamilies(port int) (net.Listener, error) {
	v4, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return nil, err
	}
	// Same port on v6; SO_REUSEADDR semantics differ per platform but binding the other
	// family on the same numeric port is allowed.
	v6, v6Err := net.Listen("tcp6", net.JoinHostPort("::1", strconv.Itoa(port)))
	if v6Err != nil {
		// IPv6 unavailable: serve IPv4 only rather than refusing to start.
		return v4, nil
	}
	return newMergedListener(v4, v6), nil
}

type mergedListener struct {
	conns  chan net.Conn
	errs   chan error
	all    []net.Listener
	done   chan struct{}
	closeO sync.Once
}

func newMergedListener(primary net.Listener, others ...net.Listener) net.Listener {
	all := append([]net.Listener{primary}, others...)
	m := &mergedListener{
		conns: make(chan net.Conn),
		errs:  make(chan error, len(all)),
		all:   all,
		done:  make(chan struct{}),
	}
	for _, ln := range all {
		go func(l net.Listener) {
			for {
				conn, err := l.Accept()
				if err != nil {
					select {
					case m.errs <- err:
					case <-m.done:
					}
					return
				}
				select {
				case m.conns <- conn:
				case <-m.done:
					_ = conn.Close()
					return
				}
			}
		}(ln)
	}
	return m
}

func (m *mergedListener) Accept() (net.Conn, error) {
	select {
	case conn := <-m.conns:
		return conn, nil
	case err := <-m.errs:
		return nil, err
	case <-m.done:
		return nil, fmt.Errorf("listener closed")
	}
}

func (m *mergedListener) Close() error {
	m.closeO.Do(func() {
		close(m.done)
		for _, ln := range m.all {
			_ = ln.Close()
		}
	})
	return nil
}

func (m *mergedListener) Addr() net.Addr { return m.all[0].Addr() }
