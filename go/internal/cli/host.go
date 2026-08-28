package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"byspace/internal/daemon"
	"byspace/internal/relay"
)

const maxPairingOfferBytes = 16 << 10

type remoteHostSummary struct {
	ServerID      string `json:"serverId"`
	RelayEndpoint string `json:"relayEndpoint"`
	UseTLS        bool   `json:"useTls"`
}

func runHost(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "host subcommand is required")
		printHostUsage(stderr)
		return 2
	}
	switch args[0] {
	case "import":
		return runHostImport(args[1:], stdin, stdout, stderr)
	case "list":
		return runHostList(args[1:], stdout, stderr)
	case "remove":
		return runHostRemove(args[1:], stdout, stderr)
	case "help", "--help", "-h":
		printHostUsage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown host subcommand %q\n", args[0])
		printHostUsage(stderr)
		return 2
	}
}

func runHostImport(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace host import", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	fileFlag := flags.String("file", "-", "private offer file, or - for stdin")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "host import reads the offer from stdin or --file, not a positional argument")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	input := stdin
	var file *os.File
	if *fileFlag != "-" {
		file, err = openPrivatePairingOfferFile(*fileFlag)
		if err != nil {
			return printError(stderr, fmt.Errorf("open pairing offer file: %w", err))
		}
		defer file.Close()
		input = file
	}
	data, err := io.ReadAll(io.LimitReader(input, maxPairingOfferBytes+1))
	if err != nil {
		return printError(stderr, errors.New("read pairing offer"))
	}
	if len(data) > maxPairingOfferBytes {
		return printError(stderr, fmt.Errorf("pairing offer exceeds %d-byte limit", maxPairingOfferBytes))
	}
	offer, err := relay.ParsePairingOfferURL(string(data))
	if err != nil {
		return printError(stderr, err)
	}
	if err := relay.ImportRemoteHost(relay.RemoteHostsPath(home), offer); err != nil {
		return printError(stderr, err)
	}
	scheme := "ws"
	if offer.Relay.UseTLS {
		scheme = "wss"
	}
	fmt.Fprintf(stdout, "Imported remote host %s (%s://%s)\n", offer.ServerID, scheme, offer.Relay.Endpoint)
	return 0
}

func openPrivatePairingOfferFile(path string) (*os.File, error) {
	expectedInfo, err := relay.ValidatePrivateFile(path)
	if err != nil {
		return nil, fmt.Errorf("offer file must be private: %w", err)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	actualInfo, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	if !os.SameFile(expectedInfo, actualInfo) {
		file.Close()
		return nil, errors.New("offer file changed while opening")
	}
	return file, nil
}

func runHostList(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace host list", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "host list does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	hosts, err := relay.LoadRemoteHosts(relay.RemoteHostsPath(home))
	if err != nil {
		return printError(stderr, err)
	}
	summaries := make([]remoteHostSummary, 0, len(hosts))
	for _, host := range hosts {
		summaries = append(summaries, remoteHostSummary{
			ServerID: host.ServerID, RelayEndpoint: host.Relay.Endpoint, UseTLS: host.Relay.UseTLS,
		})
	}
	if *jsonOutput {
		return printJSON(stdout, stderr, summaries)
	}
	for _, host := range summaries {
		scheme := "ws"
		if host.UseTLS {
			scheme = "wss"
		}
		fmt.Fprintf(stdout, "%s\t%s://%s\n", host.ServerID, scheme, host.RelayEndpoint)
	}
	return 0
}

func runHostRemove(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace host remove", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		args = append(append([]string{}, args[1:]...), args[0])
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(stderr, "host remove requires one server ID")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	serverID := flags.Arg(0)
	if err := relay.RemoveRemoteHost(relay.RemoteHostsPath(home), serverID); err != nil {
		return printError(stderr, err)
	}
	fmt.Fprintf(stdout, "Removed remote host %s\n", serverID)
	return 0
}

func printHostUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: byspace host <import|list|remove> [options]")
}
