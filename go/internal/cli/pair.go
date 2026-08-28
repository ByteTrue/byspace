package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"byspace/internal/daemon"
	"byspace/internal/relay"
)

type relayPairingOffer = relay.PairingOfferV3

type pairingOfferPayload struct {
	RequestID    string            `json:"requestId"`
	Offer        relayPairingOffer `json:"offer"`
	URL          string            `json:"url"`
	QR           *string           `json:"qr"`
	RelayEnabled bool              `json:"relayEnabled"`
	Error        string            `json:"error,omitempty"`
}

func runPair(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace pair", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	relayURLFlag := flags.String("relay-url", "", "expected Relay WebSocket origin")
	appURLFlag := flags.String("app-url", "https://app.byspace.cc.cd/", "Web app URL")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "pair does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	relayURL, err := resolveRelayURL(*relayURLFlag)
	if err != nil {
		return printError(stderr, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	client, err := connectLocalDaemon(ctx, home)
	if err != nil {
		return printError(stderr, fmt.Errorf("connect to local daemon: %w", err))
	}
	defer client.socket.CloseNow()

	var payload pairingOfferPayload
	for {
		requestID := newRequestID()
		request := map[string]any{
			"type": "daemon.get_pairing_offer.request", "requestId": requestID,
			"appUrl": *appURLFlag,
		}
		if relayURL != "" {
			request["relayUrl"] = relayURL
		}
		if err := client.write(ctx, request); err != nil {
			return printError(stderr, fmt.Errorf("request pairing offer: %w", err))
		}
		envelope, err := client.readResponse(ctx, "daemon.get_pairing_offer.response", requestID, nil)
		if err != nil {
			return printError(stderr, fmt.Errorf("read pairing offer: %w", err))
		}
		if err := json.Unmarshal(envelope.Message.Payload, &payload); err != nil {
			return printError(stderr, fmt.Errorf("decode pairing offer: %w", err))
		}
		if payload.Error != "" {
			return printError(stderr, errors.New(payload.Error))
		}
		if payload.Offer.Version == 0 {
			return printError(stderr, errors.New("daemon Relay transport is disabled"))
		}
		if payload.RelayEnabled {
			break
		}
		select {
		case <-ctx.Done():
			return printError(stderr, errors.New("daemon Relay control channel is not ready"))
		case <-time.After(100 * time.Millisecond):
		}
	}

	if *jsonOutput {
		return printJSON(stdout, stderr, payload)
	}
	fmt.Fprintln(stdout, payload.URL)
	return 0
}
