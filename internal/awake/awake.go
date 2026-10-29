// Package awake prevents the computer from idle-sleeping while agents are
// actively working or within Grace (10 minutes) after the last agent work
// finished (ported from magpie's internal/awake).
package awake

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"
)

// Grace is how long after the last active agent turn ended sleep is still held off.
var Grace = 10 * time.Minute

var tick = 5 * time.Second

var hold = takeHold

// Level controls how much sleep inhibition is requested.
type Level string

const (
	Off     Level = "off"
	System  Level = "system"  // default: inhibit system idle sleep, allow display to dim/sleep
	Display Level = "display" // inhibit both system and display idle sleep
)

// NormalizeLevel returns a valid Level, defaulting empty/unknown values to System.
func NormalizeLevel(raw string) Level {
	switch Level(strings.ToLower(strings.TrimSpace(raw))) {
	case Off:
		return Off
	case Display:
		return Display
	default:
		return System
	}
}

// State describes whether any agent is currently working and when it last worked.
type State struct {
	Busy bool
	Last time.Time
}

func want(st State, now time.Time) bool {
	return st.Busy || (!st.Last.IsZero() && now.Sub(st.Last) < Grace)
}

var (
	wakeMu sync.Mutex
	wakeCh = make(chan struct{}, 1)
)

// Notify wakes the Keep loop immediately when the user changes the KeepAwake setting.
func Notify() {
	select {
	case wakeCh <- struct{}{}:
	default:
	}
}

// Keep holds system sleep off according to level() while state() reports active or recent agent work.
func Keep(ctx context.Context, level func() Level, state func() State) {
	var release func()
	held := Off
	letGo := func() {
		if release != nil {
			release()
			release = nil
			held = Off
			log.Println("byspace awake: agents are idle; system sleep released")
		}
	}
	defer letGo()

	failed := false
	ticker := time.NewTicker(tick)
	defer ticker.Stop()

	step := func() {
		l := level()
		if l != Off && want(state(), time.Now()) {
			if release != nil && held != l {
				release()
				release = nil
				held = Off
			}
			if release == nil {
				r, err := hold(l == Display)
				if err != nil {
					if !failed {
						failed = true
						log.Printf("byspace awake: could not inhibit sleep: %v", err)
					}
				} else {
					failed = false
					release = r
					held = l
					log.Printf("byspace awake: holding %s sleep off while agents work", l)
				}
			}
		} else {
			failed = false
			letGo()
		}
	}

	step()
	for {
		select {
		case <-ctx.Done():
			return
		case <-wakeCh:
			step()
		case <-ticker.C:
			step()
		}
	}
}
