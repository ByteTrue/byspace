package pi

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/imageout"
)

// sanitizeToolResult removes inline base64 before tool output enters the persisted timeline.
// Images are materialized once and returned as markdown for a following assistant row.
func sanitizeToolResult(result any, homeDir string) (any, string) {
	markdown := make([]string, 0)
	visit := func(value any, structured bool) any {
		var walk func(any, bool) any
		walk = func(value any, structured bool) any {
			switch typed := value.(type) {
			case []any:
				out := make([]any, len(typed))
				for i, entry := range typed {
					out[i] = walk(entry, structured)
				}
				return out
			case map[string]any:
				data, _ := typed["data"].(string)
				mimeType, _ := typed["mimeType"].(string)
				isImage := typed["type"] == "image" || (data != "" && strings.HasPrefix(mimeType, "image/"))
				if isImage && data != "" {
					if text, ok := imageout.RenderAsMarkdown(imageout.ProviderImage{Data: data, MimeType: mimeType}, homeDir); ok {
						markdown = append(markdown, text)
					}
					if !structured {
						return map[string]any{"type": "text", "text": "[image]"}
					}
				}
				out := make(map[string]any, len(typed))
				for key, entry := range typed {
					if structured && isImage && key == "data" {
						out[key] = "[image]"
						continue
					}
					out[key] = walk(entry, structured || key == "structuredContent")
				}
				return out
			default:
				return value
			}
		}
		return walk(value, structured)
	}
	sanitized := visit(result, false)
	return sanitized, strings.Join(markdown, "\n")
}
