package structured

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// DefaultMaxRetries is how many times a reply is re-asked before giving up.
//
// Two extra attempts: a model that produced prose instead of JSON usually complies when told what
// was wrong, and a third failure means it will not.
const DefaultMaxRetries = 2

// ResponseError reports that every attempt produced unusable JSON.
type ResponseError struct {
	// LastResponse is what the model said last, so the caller can log or show it.
	LastResponse string
	// ValidationErrors is what was wrong, one line per problem.
	ValidationErrors []string
}

func (e *ResponseError) Error() string {
	return "agent response did not match the required JSON schema"
}

// FallbackAttempt records one provider's turn in a fallback chain.
type FallbackAttempt struct {
	Provider  string
	Model     string
	Available bool
	Err       string
}

// FallbackError reports that every provider failed.
type FallbackError struct {
	Attempts []FallbackAttempt
}

func (e *FallbackError) Error() string {
	if len(e.Attempts) == 0 {
		return "structured generation failed for all providers"
	}
	parts := make([]string, 0, len(e.Attempts))
	for _, attempt := range e.Attempts {
		modelSuffix := ""
		if attempt.Model != "" {
			modelSuffix = " (" + attempt.Model + ")"
		}
		state := "failed"
		if !attempt.Available {
			state = "unavailable"
		}
		line := attempt.Provider + modelSuffix + ": " + state
		if attempt.Err != "" {
			line += " (" + attempt.Err + ")"
		}
		parts = append(parts, line)
	}
	return "structured generation failed for all providers: " + strings.Join(parts, "; ")
}

// Validator checks a parsed value against a JSON schema.
type Validator func(value any) (any, []string)

// Caller asks the model for a reply.
type Caller func(ctx context.Context, prompt string) (string, error)

// Options configures one structured request.
type Options struct {
	// Prompt is what the user asked for.
	Prompt string
	// Schema is the JSON Schema the reply must satisfy, as JSON text.
	Schema []byte
	// SchemaName labels the schema in the prompt.
	SchemaName string
	// MaxRetries defaults to DefaultMaxRetries.
	MaxRetries *int
}

// Get asks for a schema-shaped JSON reply, retrying with the validation errors fed back.
//
// The retry prompt carries the specific errors rather than a generic "try again": a model told
// `model: is not one of the allowed values` fixes it, while one told "invalid" guesses differently.
func Get(ctx context.Context, caller Caller, options Options, validate Validator) (any, error) {
	maxRetries := DefaultMaxRetries
	if options.MaxRetries != nil {
		maxRetries = *options.MaxRetries
	}
	schemaName := options.SchemaName
	if strings.TrimSpace(schemaName) == "" {
		schemaName = "Response"
	}

	basePrompt := buildBasePrompt(options.Prompt, options.Schema, schemaName)
	attemptPrompt := basePrompt
	lastResponse := ""
	var lastErrors []string

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		response, err := caller(ctx, attemptPrompt)
		if err != nil {
			// A transport error is not a schema violation: retrying with the same prompt would
			// just repeat it.
			return nil, err
		}
		lastResponse = response

		jsonText := ExtractJSON(response)
		var parsed any
		if err := json.Unmarshal([]byte(jsonText), &parsed); err != nil {
			lastErrors = []string{"Invalid JSON: " + err.Error()}
			if attempt == maxRetries {
				break
			}
			attemptPrompt = buildRetryPrompt(basePrompt, lastErrors)
			continue
		}

		value, problems := validate(parsed)
		if len(problems) == 0 {
			return value, nil
		}
		lastErrors = problems
		if attempt == maxRetries {
			break
		}
		attemptPrompt = buildRetryPrompt(basePrompt, lastErrors)
	}

	return nil, &ResponseError{LastResponse: lastResponse, ValidationErrors: lastErrors}
}

// Candidate is one provider to try.
type Candidate struct {
	Provider string
	Model    string
	Thinking string
}

// Available reports whether a provider can run, and why not.
type Available func(ctx context.Context, provider string) (bool, string)

// RunOne generates with one candidate.
type RunOne func(ctx context.Context, candidate Candidate, options Options) (any, error)

// GetWithFallback tries each provider in turn.
//
// Ported from generateStructuredAgentResponseWithFallback. An unavailable provider is recorded and
// skipped rather than attempted: a provider whose CLI is missing would fail the same way every
// time, and the user needs to know which one it was.
func GetWithFallback(ctx context.Context, candidates []Candidate, options Options, available Available, run RunOne) (any, error) {
	if len(candidates) == 0 {
		return nil, &FallbackError{}
	}

	attempts := make([]FallbackAttempt, 0, len(candidates))
	for _, candidate := range candidates {
		usable, reason := available(ctx, candidate.Provider)
		if !usable {
			attempts = append(attempts, FallbackAttempt{
				Provider:  candidate.Provider,
				Model:     candidate.Model,
				Available: false,
				Err:       reason,
			})
			continue
		}

		value, err := run(ctx, candidate, options)
		if err == nil {
			return value, nil
		}
		attempts = append(attempts, FallbackAttempt{
			Provider:  candidate.Provider,
			Model:     candidate.Model,
			Available: true,
			Err:       err.Error(),
		})
	}

	return nil, &FallbackError{Attempts: attempts}
}

// buildBasePrompt appends the schema to the user's prompt.
func buildBasePrompt(prompt string, schema []byte, schemaName string) string {
	// The schema is re-indented rather than passed through as given: a compact schema is unreadable
	// to a model that has to match it field by field.
	var parsed any
	indented := schema
	if err := json.Unmarshal(schema, &parsed); err == nil {
		if pretty, marshalErr := json.MarshalIndent(parsed, "", "  "); marshalErr == nil {
			indented = pretty
		}
	}
	return strings.TrimSpace(prompt) + "\n\n" +
		"You must respond with JSON only that matches this JSON Schema (" + schemaName + "):\n" +
		string(indented)
}

// buildRetryPrompt adds the previous errors to the base prompt.
func buildRetryPrompt(basePrompt string, problems []string) string {
	var builder strings.Builder
	builder.WriteString(basePrompt)
	builder.WriteString("\n\nPrevious response was invalid with validation errors:\n")
	if len(problems) == 0 {
		builder.WriteString("- Unknown validation error")
	} else {
		for _, problem := range problems {
			builder.WriteString("- ")
			builder.WriteString(problem)
			builder.WriteString("\n")
		}
	}
	builder.WriteString("\nRespond again with JSON only that matches the schema.")
	return builder.String()
}

// ValidateJSONSchema checks a value against a subset of JSON Schema.
//
// A full implementation is a dependency the daemon does not need for this: the schemas that reach
// here come from `run --output-schema`, and the cases a model gets wrong are a missing required
// property, a wrong type, and a value outside an enum. Those three are implemented; anything else
// is accepted, which is the safe direction — a false accept shows the caller a value it can then
// reject, while a false reject burns the retries.
func ValidateJSONSchema(schema []byte) Validator {
	var root map[string]any
	if err := json.Unmarshal(schema, &root); err != nil {
		// An unparseable schema cannot constrain anything; accept and let the caller decide.
		return func(value any) (any, []string) { return value, nil }
	}
	return func(value any) (any, []string) {
		problems := make([]string, 0, 4)
		validateAgainst(root, value, "", &problems)
		return value, problems
	}
}

// validateAgainst applies the supported keywords at one level.
func validateAgainst(schema map[string]any, value any, path string, problems *[]string) {
	if path == "" {
		path = "(root)"
	}

	if expected, ok := schema["type"].(string); ok && !typeMatches(expected, value) {
		*problems = append(*problems, path+": expected "+expected)
		return
	}

	if allowed, ok := schema["enum"].([]any); ok && len(allowed) > 0 {
		found := false
		for _, candidate := range allowed {
			if fmt.Sprint(candidate) == fmt.Sprint(value) {
				found = true
				break
			}
		}
		if !found {
			*problems = append(*problems, path+": is not one of the allowed values")
		}
	}

	record, ok := value.(map[string]any)
	if !ok {
		return
	}
	if required, ok := schema["required"].([]any); ok {
		for _, raw := range required {
			name, _ := raw.(string)
			if _, present := record[name]; !present {
				*problems = append(*problems, path+": missing required property '"+name+"'")
			}
		}
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		for name, rawSchema := range properties {
			child, ok := rawSchema.(map[string]any)
			if !ok {
				continue
			}
			childValue, present := record[name]
			if !present {
				continue
			}
			childPath := name
			if path != "(root)" {
				childPath = path + "." + name
			}
			validateAgainst(child, childValue, childPath, problems)
		}
	}
}

// typeMatches reports whether a JSON value satisfies a JSON Schema type name.
func typeMatches(expected string, value any) bool {
	switch expected {
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array":
		_, ok := value.([]any)
		return ok
	case "string":
		_, ok := value.(string)
		return ok
	case "number":
		switch value.(type) {
		case float64, int, int64, json.Number:
			return true
		}
		return false
	case "integer":
		if number, ok := value.(float64); ok {
			return number == float64(int64(number))
		}
		switch value.(type) {
		case int, int64:
			return true
		}
		return false
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "null":
		return value == nil
	}
	// An unknown type name must not reject the value: the schema is the caller's, and refusing to
	// answer because we do not implement a keyword is worse than answering.
	return true
}

// ErrNoSchema reports a request without a schema.
var ErrNoSchema = errors.New("a JSON schema is required")
