//go:build android && !nogui

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func init() {
	// In -buildmode=c-shared (libwails.so), main() is not called automatically by the runtime;
	// registering it lets WailsBridge.nativeInit invoke main() on a Go goroutine.
	application.RegisterAndroidMain(main)
}
