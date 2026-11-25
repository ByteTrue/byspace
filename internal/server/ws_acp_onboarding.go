package server

import (
	"context"
	"fmt"
)

func (s *Server) handleACPOnboardingPrompt(ctx context.Context, sink frameSink, requestID string) {
	path, err := materializeACPOnboardingResource(s.homeDir)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "provider.acp.get_onboarding_prompt.response", map[string]any{
			"requestId": requestID, "prompt": nil, "error": err.Error(),
		})
		return
	}
	prompt := fmt.Sprintf("Read and follow the ACP onboarding guide at %q on the daemon host. If I have not named one, ask which ACP-compatible agent I want to connect. Write its canonical configuration with byspace provider add acp, then run byspace daemon reload, byspace provider diagnostic, and byspace provider check in that order as the guide directs. Do not modify BySpace source. The guide is a daemon resource, not a skill to install; do not copy it into agent skill directories.", path)
	_ = sendSessionMsg(ctx, sink, "provider.acp.get_onboarding_prompt.response", map[string]any{
		"requestId": requestID, "prompt": prompt, "error": nil,
	})
}
