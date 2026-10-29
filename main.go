package main

import (
	"os"

	"github.com/ByteTrue/byspace/internal/cli"
)

// version is set via -ldflags "-X main.version=..." at release build time.
var version = "dev"

func main() {
	os.Exit(cli.Main(version, os.Args[1:], os.Stdout, os.Stderr))
}
