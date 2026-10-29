//go:build !windows && !nogui

package gui

import "github.com/wailsapp/wails/v3/pkg/application"

func checkWebView2Runtime(*application.App) bool { return true }
