package relay

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestRemoteHostsImportListConflictAndRemove(t *testing.T) {
	directory := RemoteHostsPath(t.TempDir())
	first := testPairingOffer()
	second := testPairingOffer()
	second.ServerID = "srv_mnopqrstuvwx"
	second.Relay.Endpoint = "127.0.0.1:8787"
	second.Relay.UseTLS = false

	var wait sync.WaitGroup
	for _, offer := range []PairingOfferV3{first, second} {
		offer := offer
		wait.Add(1)
		go func() {
			defer wait.Done()
			if err := ImportRemoteHost(directory, offer); err != nil {
				t.Errorf("import %s: %v", offer.ServerID, err)
			}
		}()
	}
	wait.Wait()
	if err := ImportRemoteHost(directory, first); err != nil {
		t.Fatalf("idempotent import: %v", err)
	}

	hosts, err := LoadRemoteHosts(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(hosts) != 2 || hosts[0] != first || hosts[1] != second {
		t.Fatalf("hosts = %+v", hosts)
	}
	info, err := os.Stat(filepath.Join(directory, first.ServerID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("remote host permissions = %04o", info.Mode().Perm())
	}

	conflict := first
	conflict.Relay.Endpoint = "relay.example:443"
	if err := ImportRemoteHost(directory, conflict); err == nil || !strings.Contains(err.Error(), "different trust material") {
		t.Fatalf("conflicting import error = %v", err)
	}
	if err := RemoveRemoteHost(directory, first.ServerID); err != nil {
		t.Fatal(err)
	}
	hosts, err = LoadRemoteHosts(directory)
	if err != nil || len(hosts) != 1 || hosts[0] != second {
		t.Fatalf("hosts after remove = %+v, err = %v", hosts, err)
	}
}

func TestRemoteHostsAtomicFailureBoundariesAndDurabilityRetry(t *testing.T) {
	offer := testPairingOffer()
	preReplaceDirectory := RemoteHostsPath(t.TempDir())
	injected := errors.New("injected failure")
	if err := importRemoteHost(
		preReplaceDirectory,
		offer,
		func(string, string) error { return injected },
		syncIdentityDirectory,
	); !errors.Is(err, injected) {
		t.Fatalf("pre-replace error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(preReplaceDirectory, offer.ServerID+".json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pre-replace destination exists or stat failed unexpectedly: %v", err)
	}

	postReplaceDirectory := RemoteHostsPath(t.TempDir())
	if err := importRemoteHost(
		postReplaceDirectory,
		offer,
		installIdentityFile,
		func(string) error { return injected },
	); !errors.Is(err, injected) {
		t.Fatalf("post-replace error = %v", err)
	}
	persisted, err := LoadRemoteHost(postReplaceDirectory, offer.ServerID)
	if err != nil || persisted != offer {
		t.Fatalf("post-replace host = %+v, err = %v", persisted, err)
	}
	if err := ImportRemoteHost(postReplaceDirectory, offer); err != nil {
		t.Fatalf("durability retry: %v", err)
	}
}

func TestRemoteHostsFailClosedOnMalformedRecords(t *testing.T) {
	for _, mutate := range []func(PairingOfferV3) []byte{
		func(offer PairingOfferV3) []byte { return []byte(`{"v":3} {}`) },
		func(offer PairingOfferV3) []byte {
			data, _ := json.Marshal(offer)
			return append(data[:len(data)-1], []byte(`,"unknown":true}`)...)
		},
		func(offer PairingOfferV3) []byte {
			offer.ServerID = "srv_mnopqrstuvwx"
			data, _ := json.Marshal(offer)
			return data
		},
	} {
		directory := RemoteHostsPath(t.TempDir())
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		offer := testPairingOffer()
		path := filepath.Join(directory, offer.ServerID+".json")
		if err := os.WriteFile(path, mutate(offer), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadRemoteHosts(directory); err == nil {
			t.Fatal("malformed remote host record was accepted")
		}
	}
}

func TestRemoteHostsRejectPublicPermissionsAndUnexpectedEntries(t *testing.T) {
	directory := RemoteHostsPath(t.TempDir())
	if err := ImportRemoteHost(directory, testPairingOffer()); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		path := filepath.Join(directory, testPairingOffer().ServerID+".json")
		if err := os.Chmod(path, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadRemoteHosts(directory); err == nil {
			t.Fatal("public remote host record was accepted")
		}
		if err := os.Chmod(path, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "unexpected.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRemoteHosts(directory); err == nil {
		t.Fatal("unexpected registry entry was accepted")
	}
	if err := os.Remove(filepath.Join(directory, "unexpected.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ".remote-host-stale.tmp"), []byte("evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRemoteHosts(directory); err == nil {
		t.Fatal("hidden interrupted-write evidence was accepted")
	}
}
