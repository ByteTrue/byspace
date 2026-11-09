package providers

import "errors"

// ErrSettingNeedsRestart marks a setter that cannot take effect in the running process.
//
// Some providers read a setting once, when the process starts (Claude's --model and --effort, any
// CLI's --permission-mode). The daemon answers "restart the agent" for those, and then performs the
// restart itself: the caller asked for a setting, not for a two-step procedure.
var ErrSettingNeedsRestart = errors.New("this provider reads the setting at launch")
