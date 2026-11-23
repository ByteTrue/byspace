//go:build linux

package filewatch

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// BenchmarkLinuxObservation reports the numbers docs/file-observation.md records: attach cost on a
// pre-populated tree, latency from a write to the callback, and the descriptors one subscription
// holds. Run it with scripts/measure-filewatch.mjs.
func BenchmarkLinuxObservation(b *testing.B) {
	root := b.TempDir()
	source := filepath.Join(root, "src")
	ignored := filepath.Join(root, "node_modules")
	buildTree(b, source, 100, 100) // 10k files in 100 directories, all watched
	buildTree(b, ignored, 100, 20) // 2k files the exclusion keeps out of the walk

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		baseline := countDescriptors(b)
		events := make(chan Event, 8)
		obs, err := Open()
		if err != nil {
			b.Fatalf("open: %v", err)
		}
		started := time.Now()
		sub, err := obs.Subscribe(root, Options{Excluded: []string{ignored}}, func(ev Event) {
			select {
			case events <- ev:
			default:
			}
		})
		if err != nil {
			b.Fatalf("subscribe: %v", err)
		}
		attach := time.Since(started)
		descriptors := countDescriptors(b) - baseline
		diag := obs.Diagnostics()

		latencies := make([]time.Duration, 0, 20)
		target := filepath.Join(source, "d0", "f0.txt")
		for n := 0; n < 20; n++ {
			for len(events) > 0 {
				<-events
			}
			wrote := time.Now()
			if err := os.WriteFile(target, []byte(fmt.Sprintf("write %d", n)), 0o644); err != nil {
				b.Fatalf("write: %v", err)
			}
			select {
			case <-events:
				latencies = append(latencies, time.Since(wrote))
			case <-time.After(5 * time.Second):
				b.Fatalf("write %d produced no event", n)
			}
		}
		sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

		b.ReportMetric(float64(attach.Microseconds()), "attach-µs")
		b.ReportMetric(float64(latencies[len(latencies)/2].Microseconds()), "latency-p50-µs")
		b.ReportMetric(float64(latencies[len(latencies)-1].Microseconds()), "latency-max-µs")
		b.ReportMetric(float64(descriptors), "fds")
		b.ReportMetric(float64(diag.Tracked), "tracked-dirs")

		sub.Release()
		if err := obs.Close(); err != nil {
			b.Fatalf("close: %v", err)
		}
	}
}

func buildTree(tb testing.TB, root string, dirs, files int) {
	tb.Helper()
	for d := 0; d < dirs; d++ {
		dir := filepath.Join(root, fmt.Sprintf("d%d", d))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			tb.Fatalf("mkdir: %v", err)
		}
		for f := 0; f < files; f++ {
			body := []byte("package example\n")
			if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", f)), body, 0o644); err != nil {
				tb.Fatalf("write: %v", err)
			}
		}
	}
}

func countDescriptors(tb testing.TB) int {
	tb.Helper()
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		tb.Fatalf("read /proc/self/fd: %v", err)
	}
	return len(entries)
}
