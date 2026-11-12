package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"strings"
	"time"
)

// runDevicesCmd serves `byspace devices`.
//
// The chain's membership lives in the daemon's replica, so the command asks the running daemon
// rather than reading the file itself. That keeps one writer and works the same against a daemon on
// another address.
func runDevicesCmd(args []string, stdout io.Writer) error {
	sub := "list"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	switch sub {
	case "list":
		return runDevicesList(rest, stdout)
	case "add":
		return runDevicesChange(rest, stdout, false)
	case "remove":
		return runDevicesChange(rest, stdout, true)
	default:
		return fmt.Errorf("unknown devices subcommand %q (list, add, remove)", sub)
	}
}

func runDevicesList(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("devices list", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	if err := fs.Parse(args); err != nil {
		return err
	}
	records, err := devicesExchange(*addr, nil)
	if err != nil {
		return err
	}
	shown := 0
	for _, record := range records {
		if record.Kind != "member" || record.Deleted {
			continue
		}
		fmt.Fprintf(stdout, "%s  %s\n", record.ID, memberPublicKey(record.Data))
		shown++
	}
	if shown == 0 {
		fmt.Fprintln(stdout, "no devices")
	}
	return nil
}

func runDevicesChange(args []string, stdout io.Writer, remove bool) error {
	name := "devices add"
	if remove {
		name = "devices remove"
	}
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	publicKey := fs.String("public-key", "", "the daemon's public key")
	if err := fs.Parse(args); err != nil {
		return err
	}
	serverID := strings.TrimSpace(fs.Arg(0))
	if serverID == "" {
		return fmt.Errorf("usage: byspace %s <serverId>", name)
	}
	change := map[string]any{"kind": "member", "id": serverID}
	if remove {
		change["delete"] = true
	} else {
		if strings.TrimSpace(*publicKey) == "" {
			return fmt.Errorf("usage: byspace devices add --public-key <key> <serverId>")
		}
		change["data"] = map[string]string{"publicKey": strings.TrimSpace(*publicKey)}
	}
	if _, err := devicesExchange(*addr, []map[string]any{change}); err != nil {
		return err
	}
	if remove {
		fmt.Fprintf(stdout, "removed %s\n", serverID)
	} else {
		fmt.Fprintf(stdout, "added %s\n", serverID)
	}
	return nil
}

type deviceRecord struct {
	Kind    string          `json:"kind"`
	ID      string          `json:"id"`
	Deleted bool            `json:"deleted"`
	Data    json.RawMessage `json:"data"`
}

func memberPublicKey(data json.RawMessage) string {
	var parsed struct {
		PublicKey string `json:"publicKey"`
	}
	_ = json.Unmarshal(data, &parsed)
	return parsed.PublicKey
}

// devicesExchange sends one hosts.sync.exchange round and returns the replica.
func devicesExchange(addr string, changes []map[string]any) ([]deviceRecord, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ws, err := dialDevicesWS(ctx, addr)
	if err != nil {
		return nil, err
	}
	defer ws.CloseNow()
	msg := map[string]any{"type": "hosts.sync.exchange.request", "requestId": "cli_devices_1"}
	if changes != nil {
		msg["changes"] = changes
	}
	if err := sendSessionReq(ctx, ws, msg); err != nil {
		return nil, err
	}
	payload, err := waitSessionResp(ctx, ws, "hosts.sync.exchange.response", "")
	if err != nil {
		return nil, err
	}
	if errMsg, _ := payload["error"].(string); errMsg != "" {
		return nil, fmt.Errorf("%s", errMsg)
	}
	raw, _ := json.Marshal(payload["records"])
	var records []deviceRecord
	if err := json.Unmarshal(raw, &records); err != nil {
		return nil, err
	}
	return records, nil
}

// dialDevicesWS is what the command dials. Tests replace it with a daemon they started.
var dialDevicesWS = dialDaemonWS
