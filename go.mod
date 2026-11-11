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
	github.com/wailsapp/wails/v3 v3.0.0
	golang.org/x/crypto v0.58.0
	golang.org/x/sys v0.49.0
	golang.org/x/term v0.47.0
)

require (
	git.sr.ht/~jackmordaunt/go-toast/v2 v2.0.3 // indirect
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/creack/pty v1.1.24 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/u-root/u-root v0.16.0 // indirect
)

// Bundled copy: the upstream Windows implementation only uses the inbox ConPTY, which drops
// mouse-mode DECSETs; the fork loads the bundled OpenConsole and falls back when it cannot.
replace github.com/aymanbagabas/go-pty => ./third_party/go-pty
