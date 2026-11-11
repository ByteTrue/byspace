//go:build windows && amd64

package terminal

import "embed"

//go:embed conpty/win32-x64/conpty.dll conpty/win32-x64/OpenConsole.exe
var conptyPayload embed.FS

const conptyPayloadDir = "conpty/win32-x64"

func conptyPayloadFiles() (dll []byte, console []byte, err error) {
	dll, err = conptyPayload.ReadFile(conptyPayloadDir + "/conpty.dll")
	if err != nil {
		return nil, nil, err
	}
	console, err = conptyPayload.ReadFile(conptyPayloadDir + "/OpenConsole.exe")
	return dll, console, err
}
