module github.com/ByteTrue/byspace

go 1.27.2

ignore (
	./node_modules
	./.dev
	./dist
)

require (
	github.com/coder/websocket v1.8.15
	github.com/creack/pty v1.1.24
	golang.org/x/crypto v0.58.0
)

require golang.org/x/sys v0.49.0 // indirect
