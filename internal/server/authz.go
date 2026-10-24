package server

import (
	"github.com/ByteTrue/byspace/internal/authz"
)

// authorizationForSink returns the principal a connection acts as.
//
// A direct local connection is the owner: the user started this daemon and holds the machine,
// so gating it behind a permission list would only introduce a way to lock themselves out. A
// connection that arrived through the relay will carry its granted permissions instead (that is
// where a restricted principal comes from), so the seam exists now and defaults to owner.
func (s *Server) authorizationForSink(sink frameSink) *authz.Authorization {
	s.mu.Lock()
	perms, ok := s.sinkPermissions[sink]
	s.mu.Unlock()
	if ok {
		return authz.New(perms)
	}
	return authz.NewOwner()
}

// SetSinkPermissions grants a connection a permission set, replacing the owner default.
func (s *Server) SetSinkPermissions(sink frameSink, permissions []string) {
	s.mu.Lock()
	if s.sinkPermissions == nil {
		s.sinkPermissions = make(map[frameSink][]string)
	}
	s.sinkPermissions[sink] = permissions
	s.mu.Unlock()
}
