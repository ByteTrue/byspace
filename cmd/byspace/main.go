// Command byspace is the single-binary AI coding agent host, web workbench,
// CLI, and E2EE relay server.
package main

import (
	"os"

	"github.com/ByteTrue/byspace/internal/cli"
)

var version = "dev"

func main() {
	os.Exit(cli.Main(version, os.Args[1:], os.Stdout, os.Stderr))
}
