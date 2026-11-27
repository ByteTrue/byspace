package chief

import (
	"strings"
	"time"
)

// ErrorClass categorizes provider and runtime failures into actionable recovery classes.
type ErrorClass string

const (
	ErrorQuotaExhausted  ErrorClass = "quota_exhausted"
	ErrorRateLimited     ErrorClass = "rate_limited"
	ErrorAuthError       ErrorClass = "auth_error"
	ErrorContextOverflow ErrorClass = "context_overflow"
	ErrorProcessCrash    ErrorClass = "process_crash"
	ErrorTransient       ErrorClass = "transient"
	ErrorFatal           ErrorClass = "fatal"
)

// ClassifiedError describes the failure class and deterministic recovery guidance.
type ClassifiedError struct {
	Class            ErrorClass    `json:"class"`
	Provider         string        `json:"provider,omitempty"`
	Message          string        `json:"message"`
	Retryable        bool          `json:"retryable"`
	NeedsHotSwap     bool          `json:"needsHotSwap"`
	NeedsHumanAction bool          `json:"needsHumanAction"`
	SuggestedBackoff time.Duration `json:"-"`
}

// ClassifyProviderError classifies errors across Claude, Codex, OpenCode, Pi, and ACP
// into deterministic recovery classes without invoking any LLM.
func ClassifyProviderError(provider, errMsg string) ClassifiedError {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	trimmed := strings.TrimSpace(errMsg)
	lower := strings.ToLower(trimmed)

	res := ClassifiedError{
		Provider: normalizedProvider,
		Message:  trimmed,
	}

	if lower == "" {
		res.Class = ErrorFatal
		res.NeedsHumanAction = true
		return res
	}

	if matchesAny(lower, authPatterns) {
		res.Class = ErrorAuthError
		res.NeedsHumanAction = true
		return res
	}

	if matchesAny(lower, contextOverflowPatterns) {
		res.Class = ErrorContextOverflow
		res.NeedsHotSwap = true
		return res
	}

	if matchesAny(lower, quotaPatterns) {
		res.Class = ErrorQuotaExhausted
		res.NeedsHotSwap = true
		res.NeedsHumanAction = true
		return res
	}

	if matchesAny(lower, rateLimitPatterns) {
		res.Class = ErrorRateLimited
		res.Retryable = true
		res.SuggestedBackoff = 15 * time.Second
		return res
	}

	if matchesAny(lower, fatalPatterns) {
		res.Class = ErrorFatal
		res.NeedsHumanAction = true
		return res
	}

	if matchesAny(lower, processCrashPatterns) {
		res.Class = ErrorProcessCrash
		res.Retryable = true
		res.SuggestedBackoff = 2 * time.Second
		return res
	}

	if matchesAny(lower, transientPatterns) {
		res.Class = ErrorTransient
		res.Retryable = true
		res.SuggestedBackoff = 5 * time.Second
		return res
	}

	if normalizedProvider == "acp" && strings.Contains(lower, "acp error -32000") {
		res.Class = ErrorFatal
		res.NeedsHumanAction = true
		return res
	}

	res.Class = ErrorFatal
	res.NeedsHumanAction = true
	return res
}

var authPatterns = []string{
	"401",
	"403",
	"unauthorized",
	"forbidden",
	"authentication_error",
	"authentication failed",
	"auth failed",
	"not authenticated",
	"unauthenticated",
	"invalid_api_key",
	"invalid api key",
	"invalid x-api-key",
	"api key not found",
	"api key expired",
	"missing api key",
	"oauth token",
	"token has expired",
	"token expired",
	"invalid_token",
	"not logged in",
	"login required",
	"please run claude login",
	"codex login",
	"providerautherror",
	"permission_error",
	"invalid credentials",
	"credentials expired",
	"auth required",
}

var contextOverflowPatterns = []string{
	"context_length_exceeded",
	"context length exceeded",
	"maximum context length",
	"context window",
	"exceeds the model's maximum context",
	"prompt is too long",
	"input is too long",
	"too many tokens",
	"token limit exceeded",
	"max_tokens_exceeded",
	"context_overflow",
	"context overflow",
	"reduce the length of the messages",
	"request_too_large",
	"payload too large",
	"content too large",
	"status 413",
	"http 413",
	"error: 413",
}

var quotaPatterns = []string{
	"insufficient_quota",
	"quota_exceeded",
	"quota exceeded",
	"exceeded your current quota",
	"free usage limit reached",
	"usage limit reached",
	"usage_limit_reached",
	"hit your limit",
	"billing_hard_limit_reached",
	"billing hard limit",
	"credit balance is too low",
	"out of credits",
	"out of extra usage",
	"spending limit",
	"spend limit",
	"monthly limit",
	"plan limit reached",
	"429 quota",
}

var rateLimitPatterns = []string{
	"rate_limit_error",
	"rate limit exceeded",
	"rate_limit_exceeded",
	"rate limit",
	"rate-limit",
	"ratelimit",
	"too many requests",
	"requests per min",
	"tokens per min",
	"retry-after",
	"throttl",
	"429",
}

var processCrashPatterns = []string{
	"process_exit",
	"process exited",
	"claude process exited",
	"codex process exited",
	"acp process exited",
	"opencode process exited",
	"pi process exited",
	"provider process exited",
	"unexpected eof",
	"broken pipe",
	"signal: killed",
	"signal: segmentation fault",
	"sigkill",
	"sigsegv",
	"sigabrt",
	"exit status",
	"exit code",
	"non-zero exit",
	"terminated unexpectedly",
	"crashed",
	"session closed",
	"status==\"closed\"",
}

var transientPatterns = []string{
	"500",
	"502",
	"503",
	"504",
	"529",
	"internal_server_error",
	"overloaded_error",
	"overloaded",
	"temporarily unavailable",
	"service unavailable",
	"bad gateway",
	"gateway timeout",
	"timed out",
	"timeout",
	"deadline exceeded",
	"econnreset",
	"econnrefused",
	"enotfound",
	"etimedout",
	"ehostunreach",
	"connection reset",
	"connection refused",
	"network error",
	"socket hang up",
	"tls handshake",
	"stream disconnected",
	"server had an error",
	"try again",
	"eof",
}

var fatalPatterns = []string{
	"executable file not found",
	"binary not found",
	"command not found",
	"enoent",
	"model_not_found",
	"model not found",
	"invalid model",
	"unsupported model",
	"invalid_request_error",
	"error_max_turns",
	"provider is unavailable",
	"references unavailable provider",
	"agent is archived",
	"invalid params",
	"-32600",
	"-32601",
	"-32602",
}

func matchesAny(haystack string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}
