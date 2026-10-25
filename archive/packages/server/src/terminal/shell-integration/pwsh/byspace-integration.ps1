# BySpace shell integration for PowerShell (pwsh and Windows PowerShell).
#
# Loaded with `-NoExit -Command ". '<this file>'"`, which runs after the user's
# profile, so the wrapper below reuses whatever prompt that profile installed.
#
# Emits the same OSC 633 command lifecycle as the zsh integration: A starts a
# prompt, B ends it, C marks an executed command, D reports that a command
# finished. The daemon consumes D to settle a plain workspace script; without it
# a finished command leaves the script reported as running forever.
#
# The script is trimmed to that contract. It deliberately carries none of the
# extras VS Code's shellIntegration.ps1 has (environment reporting, nonce,
# accessibility, key handlers, Python activation) -- this integration's only
# consumer is the terminal that loaded it.

# Re-entrancy guard: a second load must not wrap the wrapper's own prompt.
if ($Global:__BySpaceState -and $null -ne $Global:__BySpaceState.OriginalPrompt) {
    return
}

# Restricted language mode cannot define functions; leave that shell alone.
if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") {
    return
}

$Global:__BySpaceState = @{
    OriginalPrompt = $function:Prompt
    LastHistoryId  = -1
    IsInExecution  = $false
    HasPSReadLine  = $false
}

function Global:Prompt() {
    # $? is the previous command's success and nothing below may clobber it
    # before we read it.
    $Succeeded = $global:?
    # Set-StrictMode off because the history entry is null in a fresh session
    # and strict mode throws instead of returning null.
    Set-StrictMode -Off
    $LastHistoryEntry = Get-History -Count 1

    $Result = ""
    # Only report a finish once a prompt has been rendered before (LastHistoryId
    # -1 is the very first prompt) and, when PSReadLine is present, once it has
    # actually handed a command to the engine -- a prompt re-render on resize
    # must not look like a command that ended.
    if (
        $Global:__BySpaceState.LastHistoryId -ne -1 -and
        ($Global:__BySpaceState.HasPSReadLine -eq $false -or $Global:__BySpaceState.IsInExecution -eq $true)
    ) {
        $Global:__BySpaceState.IsInExecution = $false
        if ($LastHistoryEntry.Id -eq $Global:__BySpaceState.LastHistoryId) {
            # Enter on an empty line, or Ctrl+C at the prompt: nothing ran, so
            # there is no exit code to report.
            $Result += "$([char]0x1b)]633;D`a"
        }
        else {
            # PowerShell exposes only success/failure for the last command:
            # $LASTEXITCODE belongs to the last *native* command and is stale
            # when a cmdlet failed. Report 0/1 rather than a number that may be
            # some earlier command's exit code.
            $ExitCode = if ($Succeeded) { 0 } else { 1 }
            $Result += "$([char]0x1b)]633;D;$ExitCode`a"
        }
    }

    # Prompt start.
    $Result += "$([char]0x1b)]633;A`a"

    # Put $? back for the user's prompt, which may read it (oh-my-posh and
    # posh-git do).
    if (-not $Succeeded) {
        Write-Error "failure" -ErrorAction Ignore
    }
    if ($Global:__BySpaceState.OriginalPrompt) {
        $Result += $Global:__BySpaceState.OriginalPrompt.Invoke()
    }

    # Prompt end: input is now accepted.
    $Result += "$([char]0x1b)]633;B`a"

    $Global:__BySpaceState.LastHistoryId = $LastHistoryEntry.Id
    $Result
}

# The engine keeps history even without PSReadLine, but IsInExecution has no
# other source, so without it a bare prompt re-render would report a finish.
# PSConsoleHostReadLine is PSReadLine's documented entry point; if a version ever
# omits it, leave the shell alone rather than replacing a function we cannot
# call through.
if ((Get-Module -Name PSReadLine) -and $null -ne $function:PSConsoleHostReadLine) {
    $Global:__BySpaceState.HasPSReadLine = $true
    $Global:__BySpaceState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine
    function Global:PSConsoleHostReadLine {
        # A command the daemon started this shell with is handed over here rather
        # than typed: PSReadLine renders the prompt long before it reads, and a
        # command typed into that window has its Enter consumed by the
        # pre-readline console buffer. Handing it off at the first read runs it
        # exactly as if the user had pressed Enter on it.
        if ($Global:__BySpaceState.PendingSpawnCommand -ne $null) {
            $PendingSpawnCommand = $Global:__BySpaceState.PendingSpawnCommand
            $Global:__BySpaceState.PendingSpawnCommand = $null
            $env:BYSPACE_TERMINAL_SPAWN_COMMAND = $null
            [Console]::Write("$([char]0x1b)]633;C`a")
            $Global:__BySpaceState.IsInExecution = $true
            return $PendingSpawnCommand
        }
        $CommandLine = $Global:__BySpaceState.OriginalPSConsoleHostReadLine.Invoke()
        $Global:__BySpaceState.IsInExecution = $true
        # Written directly: this runs outside prompt rendering, where there is
        # no return value to append to.
        [Console]::Write("$([char]0x1b)]633;C`a")
        $CommandLine
    }
    $Global:__BySpaceState.PendingSpawnCommand = $env:BYSPACE_TERMINAL_SPAWN_COMMAND
    $env:BYSPACE_TERMINAL_SPAWN_COMMAND = $null
}
