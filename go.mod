module github.com/ByteTrue/byspace

go 1.27.2

ignore (
	./.dev
	./dist
	./node_modules
)

require (
	github.com/aymanbagabas/go-pty v0.2.3
	github.com/coder/websocket v1.8.15
	github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e
	github.com/syumai/workers-go v0.36.1-0.20260923184945-a38be30753a4
	golang.org/x/crypto v0.58.0
)

require (
	github.com/creack/pty v1.1.24 // indirect
	github.com/u-root/u-root v0.16.0 // indirect
	golang.org/x/sys v0.49.0 // indirect
)
