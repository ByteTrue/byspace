package providers

import "testing"

func TestOpenCodeMajorVersion(t *testing.T) {
	tests := []struct {
		output  string
		want    int
		wantErr bool
	}{
		{output: "opencode v2.0.10", want: 2},
		{output: "\x1b[1mopencode\x1b[0m \x1b[2mv\x1b[0m\x1b[1m2.3.2\x1b[0m\n", want: 2},
		{output: "v2.0.10-beta.1", want: 2},
		{output: "1.2.3", want: 1},
		{output: "legacy wrapper", want: 1},
		{output: "2.0.9", wantErr: true},
		{output: "3.0.0", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.output, func(t *testing.T) {
			got, err := openCodeMajorVersion(tt.output)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("version = %d, want %d", got, tt.want)
			}
		})
	}
}
