// Port of archive/expo-app:packages/app/src/components/terminal-pane.tsx. The terminal logic is the Expo file's
// (stream attach and replay, size claims, focus, keys and modifiers, paste, copy, local file links,
// the phone's key rows); the view is DOM and Tailwind.
// Converted from the Expo file by archive/expo-app:web/scripts/port/terminal-pane.py; edit it directly.
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as Clipboard from "~/lib/clipboard";
import { Keyboard as KeyboardIcon, KeyboardOff as KeyboardOffIcon } from "lucide-react";
import type { TerminalKeyInput } from "@bytetrue/protocol/terminal-key-input";
import type { TerminalState } from "@bytetrue/protocol/messages";
import {
  DEFAULT_TERMINAL_INPUT_MODE_STATE,
  type TerminalInputModeState,
} from "@bytetrue/protocol/terminal-input-mode";
import { useTranslation } from "react-i18next";
import { Spinner } from "~/components/ui/spinner";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionEpoch,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  hasPendingTerminalModifiers,
  resolvePendingModifierDataInput,
} from "@/utils/terminal-keys";
import {
  createTerminalKeyInput,
  dispatchTerminalKeyInput,
  EMPTY_TERMINAL_KEY_MODIFIERS,
  type TerminalKeyModifierState,
} from "@/terminal/runtime/terminal-key-dispatch";
import {
  getTerminalVirtualKeyboardControlId,
  shouldShowTerminalFloatingCopyAction,
  TERMINAL_VIRTUAL_KEYBOARD_ROWS,
  type TerminalVirtualKeyboardControl,
} from "@/terminal/runtime/terminal-virtual-keyboard";
import { pasteTerminalClipboard } from "@/terminal/runtime/terminal-paste";
import { getWorkspaceTerminalSession } from "@/terminal/runtime/workspace-terminal-session";
import {
  EMPTY_FOCUS_CLAIM_STATE,
  canRequestFocusClaim,
  reconcileFocusClaim,
  resolveTerminalResizeClaim,
  settleFocusClaim,
} from "@/components/terminal-pane-focus-claim";
import {
  TerminalStreamController,
  type TerminalStreamControllerStatus,
} from "@/terminal/runtime/terminal-stream-controller";
import { resolveTerminalRestoreOptions } from "@/terminal/runtime/terminal-restore-options";
import { usePanelStore } from "@/stores/panel-store";
import { useBlockMobilePanelOpenGestures } from "@/mobile-panels/provider";
import { useSessionStore } from "@/stores/session-store";
import { resolveTerminalTheme } from "@/appearance/terminal-theme";
import { toXtermTheme } from "@/utils/to-xterm-theme";
import TerminalEmulator, { type TerminalEmulatorHandle } from "@/components/terminal-emulator";
import {
  TerminalFloatingCopyAction,
  TerminalPasteAction,
} from "@/components/terminal-copy-paste-actions";
import { useIsCompactFormFactor } from "@/constants/layout";
import { nativePerformanceTrace, traceInstant } from "@/performance/native-trace";
import {
  applyTerminalRendererReadyChange,
  shouldReplayTerminalSnapshotForRenderer,
  shouldShowTerminalLoadingOverlay,
  type TerminalRendererReadyChange,
} from "@/utils/terminal-renderer-readiness";
import { useAppSettings } from "@/hooks/use-settings";
import { classifyForResolution, fetchDaemonResolution } from "@/assistant-file-links/resolver";
import type {
  TerminalClipboardImage,
  TerminalPasteErrorReason,
} from "@/terminal/runtime/terminal-emulator-runtime";
import type {
  TerminalLocalFileLinkSource,
  TerminalLocalFileLinkTarget,
} from "@/terminal/local-links/terminal-local-link-provider";
import {
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { useThemeObject } from "~/app/theme-object";

interface TerminalPaneProps {
  serverId: string;
  cwd: string;
  terminalId: string;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onOpenFileExplorer: () => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
}

// Trailing window that collapses one burst of passive refits into a single PTY resize.
// ponytail: fixed delay, not adaptive — shorten only if drift correction ever feels late.
const PASSIVE_TERMINAL_RESIZE_COALESCE_MS = 250;

const MODIFIER_LABELS = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
} as const;

const EMPTY_MODIFIERS = EMPTY_TERMINAL_KEY_MODIFIERS;

type ModifierState = TerminalKeyModifierState;

type PendingTerminalInput =
  | {
      type: "data";
      data: string;
    }
  | {
      type: "key";
      input: TerminalKeyInput;
    };

function terminalScopeKey(input: { serverId: string; cwd: string }): string {
  return `${input.serverId}:${input.cwd}`;
}

/** Terminal-scheme colors for the virtual keyboard, resolved by the pane. */
interface TerminalKeyPalette {
  border: string;
  surface: string;
  surfaceHovered: string;
  activeBorder: string;
  text: string;
  textActive: string;
}

const KEY_BUTTON_CLASS_NAME =
  "flex h-[34px] min-w-0 flex-1 items-center justify-center rounded-md border px-1 text-sm font-medium border-(--key-border) bg-(--key-surface) text-(--key-text) hover:bg-(--key-surface-hovered) active:bg-(--key-surface-hovered)";

/** The key's colors as CSS variables, so hover and press can read them. */
function keyPaletteStyle(palette: TerminalKeyPalette, active: boolean): CSSProperties {
  return {
    "--key-border": active ? palette.activeBorder : palette.border,
    "--key-surface": active ? palette.surfaceHovered : palette.surface,
    "--key-surface-hovered": palette.surfaceHovered,
    "--key-text": active ? palette.textActive : palette.text,
  } as CSSProperties;
}

interface ModifierButtonProps {
  modifier: keyof ModifierState;
  active: boolean;
  palette: TerminalKeyPalette;
  onToggle: (modifier: keyof ModifierState) => void;
}

function ModifierButton({ modifier, active, palette, onToggle }: ModifierButtonProps) {
  const handlePress = useCallback(() => onToggle(modifier), [onToggle, modifier]);
  const style = useMemo(() => keyPaletteStyle(palette, active), [active, palette]);
  return (
    <button
      type="button"
      data-testid={`terminal-key-${modifier}`}
      aria-pressed={active}
      onClick={handlePress}
      style={style}
      className={KEY_BUTTON_CLASS_NAME}
    >
      {MODIFIER_LABELS[modifier]}
    </button>
  );
}

interface VirtualKeyButtonProps {
  id: string;
  label: string;
  keyValue: string;
  palette: TerminalKeyPalette;
  onSend: (key: string) => void;
}

function VirtualKeyButton({ id, label, keyValue, palette, onSend }: VirtualKeyButtonProps) {
  const handlePress = useCallback(() => onSend(keyValue), [onSend, keyValue]);
  const style = useMemo(() => keyPaletteStyle(palette, false), [palette]);
  return (
    <button
      type="button"
      data-testid={`terminal-key-${id}`}
      onClick={handlePress}
      style={style}
      className={KEY_BUTTON_CLASS_NAME}
    >
      {label}
    </button>
  );
}

interface KeyboardToggleButtonProps {
  isKeyboardVisible: boolean;
  iconColor: string;
  palette: TerminalKeyPalette;
  onToggle: () => void;
}

function KeyboardToggleButton({
  isKeyboardVisible,
  iconColor,
  palette,
  onToggle,
}: KeyboardToggleButtonProps) {
  const label = isKeyboardVisible ? "Hide keyboard" : "Show keyboard";
  const Icon = isKeyboardVisible ? KeyboardOffIcon : KeyboardIcon;
  const style = useMemo(() => keyPaletteStyle(palette, false), [palette]);
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="terminal-keyboard-toggle"
      onClick={onToggle}
      style={style}
      className={KEY_BUTTON_CLASS_NAME}
    >
      <Icon color={iconColor} size={16} />
    </button>
  );
}

export function TerminalPane({
  serverId,
  cwd,
  terminalId,
  isWorkspaceFocused,
  isPaneFocused,
  onOpenFileExplorer,
  onOpenWorkspaceFile,
}: TerminalPaneProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const retainedPanelActive = useRetainedPanelActive();
  const isAppActivelyVisible = useAppActivelyVisible();
  const theme = useThemeObject();
  const { settings } = useAppSettings();
  // The terminal keeps its own scheme, independent of the app theme when the
  // user forces one. Everything painted over the terminal surface — xterm
  // palette, virtual keyboard, inline error row — follows the resolved
  // terminal theme, not the app theme.
  const terminalTheme = useMemo(
    () => resolveTerminalTheme(theme, settings.terminalAppearance),
    [theme, settings.terminalAppearance],
  );
  const xtermTheme = useMemo(() => toXtermTheme(terminalTheme.colors.terminal), [terminalTheme]);
  const terminalFontFamily = useMemo(() => {
    const trimmed = settings.monoFontFamily.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [settings.monoFontFamily]);
  const isMobile = useIsCompactFormFactor();
  const mobileView = usePanelStore((state) => state.mobilePanel.target);
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);
  const swipeGesturesEnabled = isMobile;
  // react-native-keyboard-controller reports no keyboard on the web, so the Expo web app never
  // shifted or reflowed for one: the browser resizes the page for the on-screen keyboard.
  const keyboardInset = 0;
  const isKeyboardVisible = false;

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const connectionEpoch = useHostRuntimeConnectionEpoch(serverId);
  const isTerminalPresented = retainedPanelActive && isWorkspaceFocused;
  const isTerminalStreamActive = isWorkspaceFocused && retainedPanelActive;
  const supportsTerminalRestoreModes = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.["terminal-restore-modes"] === true,
  );
  const supportsTerminalInputModeReplay = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.["terminal-input-mode-replay"] === true,
  );
  const supportsTerminalSizeOwnership = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.["terminal-size-ownership"] === true,
  );
  const setFocusedTerminalId = useSessionStore((state) => state.setFocusedTerminalId);

  const scopeKey = useMemo(() => terminalScopeKey({ serverId, cwd }), [serverId, cwd]);
  const terminalStreamKey = useMemo(() => `${scopeKey}:${terminalId}`, [scopeKey, terminalId]);
  const focusClaimIdentity = isConnected ? `${connectionEpoch}:${terminalStreamKey}` : null;
  // Keep the latest measured size for whichever client currently owns the pane,
  // but only dedupe resizes that this specific client has already pushed.
  const measuredTerminalSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const lastSentTerminalSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const passiveResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamControllerRef = useRef<TerminalStreamController | null>(null);
  const workspaceTerminalSession = useMemo(
    () => getWorkspaceTerminalSession({ scopeKey }),
    [scopeKey],
  );
  const completedAttachIdentityRef = useRef<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [rendererReadyStreamKey, setRendererReadyStreamKey] = useState<string | null>(null);
  const isTerminalRendererReady = rendererReadyStreamKey === terminalStreamKey;
  const canClaimTerminalSize =
    isPaneFocused &&
    canRequestFocusClaim({
      isWorkspaceFocused: isTerminalPresented,
      isPaneFocused,
      isAppActivelyVisible,
      isClientReady: client !== null,
      isConnected,
      isRendererReady: isTerminalRendererReady,
    });
  const shouldAttachTerminalStream = isTerminalStreamActive && isTerminalRendererReady;
  const [modifiers, setModifiers] = useState<ModifierState>(EMPTY_MODIFIERS);
  const [hasSelection, setHasSelection] = useState(false);
  const [hasClipboardText, setHasClipboardText] = useState(false);
  const [isKeyboardToggleVisible, setIsKeyboardToggleVisible] = useState(false);
  const [focusRequestToken, setFocusRequestToken] = useState(0);
  const [resizeRequestToken, setResizeRequestToken] = useState(0);
  useBlockMobilePanelOpenGestures(isMobile && isWorkspaceFocused && isPaneFocused && hasSelection);
  const emulatorRef = useRef<TerminalEmulatorHandle>(null);
  const terminalIdRef = useRef<string>(terminalId);
  const resumeAnchorRef = useRef<{
    emulator: TerminalEmulatorHandle;
    terminalId: string;
  } | null>(null);
  const markResumeAnchor = useStableEvent((anchorTerminalId: string) => {
    const emulator = emulatorRef.current;
    if (emulator) {
      resumeAnchorRef.current = { emulator, terminalId: anchorTerminalId };
    }
  });
  const terminalPresentedRef = useRef(isTerminalPresented);
  terminalPresentedRef.current = isTerminalPresented;
  const inputModeRef = useRef<TerminalInputModeState>(DEFAULT_TERMINAL_INPUT_MODE_STATE);
  const pendingTerminalInputRef = useRef<PendingTerminalInput[]>([]);
  const lastAutoFocusKeyRef = useRef<string | null>(null);
  const paneFocusResizeClaimRef = useRef(EMPTY_FOCUS_CLAIM_STATE);
  const canClaimTerminalSizeRef = useRef(canClaimTerminalSize);
  canClaimTerminalSizeRef.current = canClaimTerminalSize;
  const hasTerminalSizeClaim = useCallback(() => {
    if (!focusClaimIdentity) {
      return false;
    }
    return (
      paneFocusResizeClaimRef.current.claimedKey === focusClaimIdentity ||
      workspaceTerminalSession.sizeClaims.get({ terminalId }) === focusClaimIdentity
    );
  }, [focusClaimIdentity, terminalId, workspaceTerminalSession.sizeClaims]);
  const initialSnapshot = workspaceTerminalSession.snapshots.get({ terminalId });

  useEffect(() => {
    terminalIdRef.current = terminalId;
    inputModeRef.current = DEFAULT_TERMINAL_INPUT_MODE_STATE;
    setHasSelection(false);
  }, [terminalId]);

  const refreshClipboardAvailability = useCallback(async () => {
    if (!isMobile) {
      setHasClipboardText(false);
      return;
    }
    try {
      const hasText = await Clipboard.hasText();
      setHasClipboardText(hasText);
    } catch {
      setHasClipboardText(false);
    }
  }, [isMobile]);

  useEffect(() => {
    void refreshClipboardAvailability();
  }, [refreshClipboardAvailability, isAppActivelyVisible]);

  useEffect(() => {
    void refreshClipboardAvailability();
  }, [keyboardInset, refreshClipboardAvailability]);

  useEffect(() => {
    setIsKeyboardToggleVisible(isKeyboardVisible);
  }, [isKeyboardVisible]);

  const handleSelectionChange = useCallback((nextHasSelection: boolean) => {
    setHasSelection(nextHasSelection);
  }, []);

  const requestTerminalFocus = useCallback(() => {
    setFocusRequestToken((current) => current + 1);
  }, []);
  const requestTerminalReflow = useCallback(() => {
    setResizeRequestToken((current) => current + 1);
  }, []);
  useEffect(() => {
    if (!isMobile || !isWorkspaceFocused || mobileView === "agent") {
      return;
    }
    emulatorRef.current?.blur();
  }, [isMobile, isWorkspaceFocused, mobileView]);
  const handleRendererReadyChange = useCallback(
    (change: TerminalRendererReadyChange) => {
      setRendererReadyStreamKey((current) => applyTerminalRendererReadyChange(current, change));
      if (isTerminalStreamActive) {
        if (change.isReady && change.streamKey === terminalStreamKey) {
          setIsAttaching(true);
        }
        return;
      }
      if (!shouldReplayTerminalSnapshotForRenderer({ change, terminalStreamKey })) {
        return;
      }

      const snapshot = workspaceTerminalSession.snapshots.get({ terminalId });
      if (snapshot) {
        emulatorRef.current?.renderSnapshot(snapshot);
      }
    },
    [isTerminalStreamActive, terminalId, terminalStreamKey, workspaceTerminalSession.snapshots],
  );

  useEffect(() => {
    if (isMobile || !isPaneFocused || !terminalId) {
      lastAutoFocusKeyRef.current = null;
      return;
    }
    if (!isWorkspaceFocused) {
      return;
    }
    const focusKey = `${scopeKey}:${terminalId}`;
    if (lastAutoFocusKeyRef.current !== focusKey) {
      lastAutoFocusKeyRef.current = focusKey;
      requestTerminalFocus();
    }
  }, [isMobile, isPaneFocused, isWorkspaceFocused, requestTerminalFocus, scopeKey, terminalId]);

  // Keep this before the stream-controller effect so reconnect attach cannot observe a prior epoch's claim.
  useEffect(() => {
    const step = reconcileFocusClaim(paneFocusResizeClaimRef.current, {
      key: terminalId ? focusClaimIdentity : null,
      canRequest: canClaimTerminalSize,
    });
    paneFocusResizeClaimRef.current = step.state;
    if (step.shouldRequest) {
      lastSentTerminalSizeRef.current = null;
      requestTerminalReflow();
      emulatorRef.current?.claimSize();
    }
  }, [canClaimTerminalSize, focusClaimIdentity, requestTerminalReflow, terminalId]);

  const handleTerminalFocus = useCallback(() => {
    if (isWorkspaceFocused && isPaneFocused) {
      setFocusedTerminalId(serverId, terminalId);
    }
    lastSentTerminalSizeRef.current = null;
    requestTerminalReflow();
    emulatorRef.current?.claimSize();
  }, [
    isPaneFocused,
    isWorkspaceFocused,
    requestTerminalReflow,
    serverId,
    setFocusedTerminalId,
    terminalId,
  ]);

  useEffect(() => {
    if (!client || !isConnected || !isWorkspaceFocused) {
      return;
    }

    return client.on("terminal_stream_exit", (message) => {
      if (message.type !== "terminal_stream_exit") {
        return;
      }

      const exitedTerminalId = message.payload.terminalId;
      if (!exitedTerminalId) {
        return;
      }

      workspaceTerminalSession.snapshots.clear({ terminalId: exitedTerminalId });
      if (resumeAnchorRef.current?.terminalId === exitedTerminalId) {
        resumeAnchorRef.current = null;
      }
      if (terminalIdRef.current === exitedTerminalId) {
        emulatorRef.current?.clear();
      }
      streamControllerRef.current?.handleTerminalExit({
        terminalId: exitedTerminalId,
      });
      setModifiers({ ...EMPTY_MODIFIERS });
    });
  }, [client, isConnected, isWorkspaceFocused, workspaceTerminalSession.snapshots]);

  const clearPassiveResizeTimer = useCallback(() => {
    if (passiveResizeTimerRef.current) {
      clearTimeout(passiveResizeTimerRef.current);
      passiveResizeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearPassiveResizeTimer, [clearPassiveResizeTimer]);

  useEffect(() => {
    measuredTerminalSizeRef.current = null;
    lastSentTerminalSizeRef.current = null;
    clearPassiveResizeTimer();
  }, [scopeKey, clearPassiveResizeTimer]);

  const handleStreamControllerStatus = useCallback(
    (status: TerminalStreamControllerStatus) => {
      if (!status.isAttaching && !status.error && status.terminalId && focusClaimIdentity) {
        completedAttachIdentityRef.current = focusClaimIdentity;
      }
      setIsAttaching(status.isAttaching);
      setStreamError(status.error);
    },
    [focusClaimIdentity],
  );

  const canUseMeasuredTerminalSize = useCallback(() => {
    return canClaimTerminalSizeRef.current || hasTerminalSizeClaim();
  }, [hasTerminalSizeClaim]);

  const getPreferredStreamSize = useStableEvent(() => {
    if (!lastSentTerminalSizeRef.current || !canUseMeasuredTerminalSize()) {
      return null;
    }
    return measuredTerminalSizeRef.current ?? lastSentTerminalSizeRef.current;
  });

  const handleStreamOutput = useStableEvent(
    ({ terminalId: outputTerminalId, data }: { terminalId: string; data: Uint8Array }) => {
      if (terminalIdRef.current !== outputTerminalId) {
        return;
      }
      if (nativePerformanceTrace.isEnabled()) {
        traceInstant("byspace.terminal.stream-controller-to-emulator-write", {
          size: String(data.byteLength),
        });
      }
      emulatorRef.current?.writeOutput(data);
      markResumeAnchor(outputTerminalId);
    },
  );

  const handleStreamRestore = useStableEvent(
    ({ terminalId: restoreTerminalId, data }: { terminalId: string; data: Uint8Array }) => {
      workspaceTerminalSession.snapshots.clear({ terminalId: restoreTerminalId });
      if (terminalIdRef.current !== restoreTerminalId) {
        return;
      }
      emulatorRef.current?.restoreOutput(data);
      markResumeAnchor(restoreTerminalId);
    },
  );

  const handleStreamSnapshot = useStableEvent(
    ({ terminalId: snapshotTerminalId, state }: { terminalId: string; state: TerminalState }) => {
      workspaceTerminalSession.snapshots.set({ terminalId: snapshotTerminalId, state });
      if (terminalIdRef.current !== snapshotTerminalId) {
        return;
      }
      emulatorRef.current?.renderSnapshot(state);
      markResumeAnchor(snapshotTerminalId);
    },
  );

  const getStreamRestoreOptions = useStableEvent(() => {
    const anchor = resumeAnchorRef.current;
    const restoreSize = canUseMeasuredTerminalSize() ? measuredTerminalSizeRef.current : null;
    if (restoreSize) {
      lastSentTerminalSizeRef.current = restoreSize;
    }
    return resolveTerminalRestoreOptions({
      supportsTerminalRestoreModes,
      canResume:
        anchor !== null &&
        anchor.emulator === emulatorRef.current &&
        anchor.terminalId === terminalIdRef.current,
      canClaimSize: canUseMeasuredTerminalSize(),
      size: restoreSize,
    });
  });

  useEffect(() => {
    streamControllerRef.current?.dispose();
    streamControllerRef.current = null;
    setIsAttaching(false);
    setStreamError(null);

    if (!client || !isConnected) {
      return;
    }

    const controller = new TerminalStreamController({
      client,
      getPreferredSize: getPreferredStreamSize,
      onOutput: handleStreamOutput,
      onRestore: handleStreamRestore,
      onSnapshot: handleStreamSnapshot,
      getRestoreOptions: getStreamRestoreOptions,
      onStatusChange: handleStreamControllerStatus,
    });

    streamControllerRef.current = controller;
    controller.setTerminal({
      terminalId: shouldAttachTerminalStream ? terminalIdRef.current : null,
    });

    return () => {
      controller.dispose();
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    };
  }, [
    client,
    getPreferredStreamSize,
    getStreamRestoreOptions,
    handleStreamControllerStatus,
    handleStreamOutput,
    handleStreamRestore,
    handleStreamSnapshot,
    isConnected,
    shouldAttachTerminalStream,
  ]);

  useEffect(() => {
    pendingTerminalInputRef.current = [];
    const nextTerminalId = shouldAttachTerminalStream ? terminalId : null;
    streamControllerRef.current?.setTerminal({
      terminalId: nextTerminalId,
    });
  }, [shouldAttachTerminalStream, terminalId]);

  const enqueuePendingTerminalInput = useCallback((entry: PendingTerminalInput) => {
    const queue = pendingTerminalInputRef.current;
    queue.push(entry);
    if (queue.length > 512) {
      queue.splice(0, queue.length - 512);
    }
  }, []);

  const dispatchTerminalInputEntry = useCallback(
    (entry: PendingTerminalInput): boolean => {
      if (!client) {
        return false;
      }

      const currentTerminalId = terminalIdRef.current;
      if (!currentTerminalId) {
        return false;
      }

      if (entry.type === "data") {
        client.sendTerminalInput(currentTerminalId, {
          type: "input",
          data: entry.data,
        });
        return true;
      }

      dispatchTerminalKeyInput({
        keyInput: entry.input,
        inputMode: inputModeRef.current,
        sendData: (data) =>
          client.sendTerminalInput(currentTerminalId, {
            type: "input",
            data,
          }),
      });
      return true;
    },
    [client],
  );

  const flushPendingTerminalInput = useCallback(() => {
    const queue = pendingTerminalInputRef.current;
    if (queue.length === 0) {
      return;
    }

    let sentCount = 0;
    while (sentCount < queue.length) {
      const entry = queue[sentCount];
      if (!entry) {
        break;
      }
      if (!dispatchTerminalInputEntry(entry)) {
        break;
      }
      sentCount += 1;
    }

    if (sentCount > 0) {
      queue.splice(0, sentCount);
    }
  }, [dispatchTerminalInputEntry]);

  useEffect(() => {
    if (!isAttaching && !streamError) {
      flushPendingTerminalInput();
    }
  }, [flushPendingTerminalInput, isAttaching, streamError]);

  const clearPendingModifiers = useCallback(() => {
    setModifiers({ ...EMPTY_MODIFIERS });
  }, []);

  const sendTerminalKey = useCallback(
    (input: {
      key: string;
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
      meta?: boolean;
    }): boolean => {
      if (!client || !terminalIdRef.current) {
        enqueuePendingTerminalInput({
          type: "key",
          input: {
            ...createTerminalKeyInput({
              key: input.key,
              modifiers: {
                ctrl: input.ctrl,
                shift: input.shift,
                alt: input.alt,
              },
              meta: input.meta,
            }),
          },
        });
        return true;
      }

      const pendingEntry: PendingTerminalInput = {
        type: "key",
        input: createTerminalKeyInput({
          key: input.key,
          modifiers: {
            ctrl: input.ctrl,
            shift: input.shift,
            alt: input.alt,
          },
          meta: input.meta,
        }),
      };
      if (!dispatchTerminalInputEntry(pendingEntry)) {
        enqueuePendingTerminalInput(pendingEntry);
      }
      return true;
    },
    [client, dispatchTerminalInputEntry, enqueuePendingTerminalInput],
  );

  const handleTerminalData = useCallback(
    async (data: string) => {
      if (data.length === 0) {
        return;
      }

      if (hasPendingTerminalModifiers(modifiers)) {
        const pendingResolution = resolvePendingModifierDataInput({
          data,
          pendingModifiers: modifiers,
        });
        if (pendingResolution.mode === "key") {
          if (
            sendTerminalKey({
              key: pendingResolution.key,
              ctrl: modifiers.ctrl,
              shift: modifiers.shift,
              alt: modifiers.alt,
              meta: false,
            })
          ) {
            clearPendingModifiers();
            return;
          }
        }

        if (pendingResolution.clearPendingModifiers) {
          clearPendingModifiers();
        }
      }

      if (!client || !terminalIdRef.current) {
        enqueuePendingTerminalInput({
          type: "data",
          data,
        });
        return;
      }
      const pendingEntry: PendingTerminalInput = {
        type: "data",
        data,
      };
      if (!dispatchTerminalInputEntry(pendingEntry)) {
        enqueuePendingTerminalInput(pendingEntry);
      }
    },
    [
      clearPendingModifiers,
      client,
      dispatchTerminalInputEntry,
      modifiers,
      sendTerminalKey,
      enqueuePendingTerminalInput,
    ],
  );

  const sendTerminalResize = useStableEvent(
    (input: {
      size: { rows: number; cols: number };
      shouldClaim: boolean;
      forceClaim?: boolean;
    }) => {
      const claim = resolveTerminalResizeClaim({
        size: input.size,
        previousSentSize: lastSentTerminalSizeRef.current,
        shouldClaim: input.shouldClaim,
        forceClaim: input.forceClaim ?? false,
        supportsTerminalSizeOwnership,
        hasClaimedSize: hasTerminalSizeClaim(),
        readiness: {
          isWorkspaceFocused: isTerminalPresented,
          isPaneFocused,
          isAppActivelyVisible,
          isClientReady: client !== null,
          isConnected,
          isRendererReady: isTerminalRendererReady,
        },
      });
      let sent = false;
      if (client && terminalId && claim.shouldSend) {
        lastSentTerminalSizeRef.current = input.size;
        client.sendTerminalInput(terminalId, {
          type: "resize",
          rows: input.size.rows,
          cols: input.size.cols,
          intent: claim.intent,
        });
        sent = true;
      }
      const requestedKey = paneFocusResizeClaimRef.current.requestedKey;
      if (requestedKey && claim.intent === "claim") {
        paneFocusResizeClaimRef.current = settleFocusClaim(paneFocusResizeClaimRef.current, {
          key: requestedKey,
          sent,
        });
        if (sent && supportsTerminalSizeOwnership && requestedKey === focusClaimIdentity) {
          workspaceTerminalSession.sizeClaims.set({
            terminalId,
            claimIdentity: requestedKey,
          });
        }
      }
    },
  );

  const handleTerminalResize = useStableEvent(
    (input: { rows: number; cols: number; shouldClaim: boolean; forceClaim?: boolean }) => {
      const { rows, cols } = input;
      if (rows <= 0 || cols <= 0) {
        return;
      }
      const nextSize = { rows: Math.floor(rows), cols: Math.floor(cols) };
      measuredTerminalSizeRef.current = nextSize;
      if (input.shouldClaim && canClaimTerminalSizeRef.current) {
        clearPassiveResizeTimer();
        sendTerminalResize({ size: nextSize, shouldClaim: true, forceClaim: input.forceClaim });
        return;
      }
      clearPassiveResizeTimer();
      passiveResizeTimerRef.current = setTimeout(() => {
        passiveResizeTimerRef.current = null;
        const settledSize = measuredTerminalSizeRef.current;
        if (settledSize) {
          sendTerminalResize({ size: settledSize, shouldClaim: false });
        }
      }, PASSIVE_TERMINAL_RESIZE_COALESCE_MS);
    },
  );

  const handleTerminalKey = useCallback(
    async (input: { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }) => {
      sendTerminalKey(input);
    },
    [sendTerminalKey],
  );

  const handlePendingModifiersConsumed = useCallback(() => {
    clearPendingModifiers();
  }, [clearPendingModifiers]);

  const handleTerminalPaste = useCallback(() => {
    requestTerminalReflow();
    void pasteTerminalClipboard({
      clipboard: { readText: () => Clipboard.readText() },
      terminal: { paste: (text) => emulatorRef.current?.paste(text) },
    }).then(() => refreshClipboardAvailability());
  }, [requestTerminalReflow, refreshClipboardAvailability]);

  const handleTerminalCopy = useCallback(() => {
    void emulatorRef.current
      ?.copySelection({
        writeText: async (text: string) => {
          await Clipboard.writeText(text);
        },
      })
      .then(() => refreshClipboardAvailability());
  }, [refreshClipboardAvailability]);

  const handleKeyboardToggle = useCallback(() => {
    if (isKeyboardToggleVisible) {
      setIsKeyboardToggleVisible(false);
      emulatorRef.current?.blur();
      requestTerminalReflow();
      return;
    }

    setIsKeyboardToggleVisible(true);
    emulatorRef.current?.showKeyboard();
    requestTerminalReflow();
  }, [isKeyboardToggleVisible, requestTerminalReflow]);

  const handleInputModeChange = useCallback((state: TerminalInputModeState) => {
    inputModeRef.current = state;
  }, []);
  const handleTerminalPasteImage = useCallback(
    async (image: TerminalClipboardImage): Promise<string | null> => {
      if (!client || !isConnected) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return null;
      }

      try {
        const result = await client.uploadFile({
          fileName: `clipboard-image.${image.fileExtension}`,
          mimeType: image.mimeType,
          bytes: image.bytes,
        });
        if (result.error) {
          throw new Error(result.error);
        }
        if (!result.file) {
          throw new Error(t("composer.errors.uploadFailed"));
        }
        return result.file.path;
      } catch (error) {
        toast.error(
          error instanceof Error && error.message.length > 0
            ? error.message
            : t("composer.errors.uploadFailed"),
        );
        return null;
      }
    },
    [client, isConnected, t, toast],
  );
  const handleTerminalPasteError = useCallback(
    (reason: TerminalPasteErrorReason) => {
      toast.error(
        t(
          reason === "image-too-large"
            ? "workspace.terminal.clipboardImageTooLarge"
            : "workspace.terminal.clipboardReadFailed",
        ),
      );
    },
    [t, toast],
  );
  const handleResolveLocalFileLink = useCallback(
    async (source: TerminalLocalFileLinkSource): Promise<TerminalLocalFileLinkTarget | null> => {
      const resolution = classifyForResolution(
        { href: source.text, text: source.text, sourceType: "inline-code" },
        { workspaceRoot: cwd },
      );
      if (resolution.kind === "resolved") {
        return resolution.value.kind === "file" ? resolution.value.target : null;
      }
      if (!client) {
        return null;
      }
      try {
        return await fetchDaemonResolution({
          ambiguousQuery: resolution.ambiguousQuery,
          token: resolution.token,
          target: resolution.target,
          workspaceRoot: cwd,
          getDirectorySuggestions: (input) => client.getDirectorySuggestions(input),
        });
      } catch {
        return null;
      }
    },
    [client, cwd],
  );
  const handleOpenLocalFileLink = useCallback(
    (target: TerminalLocalFileLinkTarget, disposition: OpenFileDisposition) => {
      const location = normalizeWorkspaceFileLocation(target);
      if (!location) {
        return;
      }
      onOpenWorkspaceFile({ location, disposition });
    },
    [onOpenWorkspaceFile],
  );

  const toggleModifier = useCallback(
    (modifier: keyof ModifierState) => {
      setModifiers((current) => ({ ...current, [modifier]: !current[modifier] }));
      requestTerminalFocus();
      requestTerminalReflow();
    },
    [requestTerminalFocus, requestTerminalReflow],
  );

  const sendVirtualKey = useCallback(
    (key: string) => {
      sendTerminalKey({
        key,
        ctrl: modifiers.ctrl,
        shift: modifiers.shift,
        alt: modifiers.alt,
        meta: false,
      });
      clearPendingModifiers();
      requestTerminalFocus();
      requestTerminalReflow();
    },
    [
      clearPendingModifiers,
      modifiers.alt,
      modifiers.ctrl,
      modifiers.shift,
      requestTerminalFocus,
      requestTerminalReflow,
      sendTerminalKey,
    ],
  );

  const containerStyle = useMemo<CSSProperties>(
    () => ({ backgroundColor: terminalTheme.colors.surface0 }),
    [terminalTheme],
  );
  const outputStyle = useMemo<CSSProperties>(
    () => ({ backgroundColor: terminalTheme.colors.background }),
    [terminalTheme],
  );
  const errorRowStyle = useMemo<CSSProperties>(
    () => ({
      borderTopColor: terminalTheme.colors.border,
      backgroundColor: terminalTheme.colors.surface1,
    }),
    [terminalTheme],
  );
  const mutedTextStyle = useMemo<CSSProperties>(
    () => ({ color: terminalTheme.colors.foregroundMuted }),
    [terminalTheme],
  );
  const errorTextStyle = useMemo<CSSProperties>(
    () => ({ color: terminalTheme.colors.destructive }),
    [terminalTheme],
  );
  const keyboardStyle = useMemo<CSSProperties>(
    () => ({
      borderTopColor: terminalTheme.colors.border,
      backgroundColor: terminalTheme.colors.surface0,
    }),
    [terminalTheme],
  );
  const terminalKeyPalette = useMemo<TerminalKeyPalette>(
    () => ({
      border: terminalTheme.colors.border,
      surface: terminalTheme.colors.surface1,
      surfaceHovered: terminalTheme.colors.surface2,
      activeBorder: terminalTheme.colors.primary,
      text: terminalTheme.colors.foregroundMuted,
      textActive: terminalTheme.colors.foreground,
    }),
    [terminalTheme],
  );

  const handleSwipeRight = useCallback(() => {
    if (!swipeGesturesEnabled) return;
    emulatorRef.current?.blur();
    showMobileAgentList();
  }, [swipeGesturesEnabled, showMobileAgentList]);

  const handleSwipeLeft = useCallback(() => {
    if (!swipeGesturesEnabled) return;
    emulatorRef.current?.blur();
    onOpenFileExplorer();
  }, [swipeGesturesEnabled, onOpenFileExplorer]);
  const showFloatingCopyAction = shouldShowTerminalFloatingCopyAction({
    hasSelection,
    isCompact: isMobile,
  });
  const keyboardToggleIconColor = terminalTheme.colors.foregroundMuted;

  const renderVirtualKeyboardControl = (control: TerminalVirtualKeyboardControl) => {
    const controlId = getTerminalVirtualKeyboardControlId(control);
    switch (control.type) {
      case "key":
        return (
          <VirtualKeyButton
            key={controlId}
            id={control.button.id}
            label={control.button.label}
            keyValue={control.button.key}
            palette={terminalKeyPalette}
            onSend={sendVirtualKey}
          />
        );
      case "modifier":
        return (
          <ModifierButton
            key={controlId}
            modifier={control.modifier}
            active={modifiers[control.modifier]}
            palette={terminalKeyPalette}
            onToggle={toggleModifier}
          />
        );
      case "paste":
        return (
          <TerminalPasteAction
            key={controlId}
            hasClipboardText={hasClipboardText}
            onPaste={handleTerminalPaste}
          />
        );
      case "keyboardToggle":
        return (
          <KeyboardToggleButton
            key={controlId}
            iconColor={keyboardToggleIconColor}
            isKeyboardVisible={isKeyboardToggleVisible}
            palette={terminalKeyPalette}
            onToggle={handleKeyboardToggle}
          />
        );
    }
  };
  const showLoadingOverlay = shouldShowTerminalLoadingOverlay({
    isWorkspaceFocused: isTerminalPresented,
    hasStreamError: Boolean(streamError),
    isAttaching: isAttaching && completedAttachIdentityRef.current !== focusClaimIdentity,
    rendererReadyStreamKey,
    terminalStreamKey,
  });

  if (!client || !isConnected) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <span className="text-center text-sm" style={mutedTextStyle}>
          {t("workspace.terminal.hostDisconnected")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={containerStyle}>
      <div className="relative flex min-h-0 flex-1 flex-col" style={outputStyle}>
        <div className="flex min-h-0 flex-1 flex-col">
          <TerminalEmulator
            ref={emulatorRef}
            streamKey={terminalStreamKey}
            supportsTerminalInputModeReplay={supportsTerminalInputModeReplay}
            testId="terminal-surface"
            xtermTheme={xtermTheme}
            scrollbackLines={settings.terminalScrollbackLines}
            fontFamily={terminalFontFamily}
            fontSize={settings.codeFontSize}
            keyboardInset={keyboardInset}
            isKeyboardVisible={isKeyboardVisible}
            swipeGesturesEnabled={swipeGesturesEnabled}
            initialSnapshot={initialSnapshot}
            onRendererReadyChange={handleRendererReadyChange}
            onSwipeRight={handleSwipeRight}
            onSwipeLeft={handleSwipeLeft}
            onInput={handleTerminalData}
            onFocus={handleTerminalFocus}
            onResize={handleTerminalResize}
            onTerminalKey={handleTerminalKey}
            onInputModeChange={handleInputModeChange}
            onPasteImage={handleTerminalPasteImage}
            onPasteError={handleTerminalPasteError}
            onSelectionChange={handleSelectionChange}
            onResolveLocalFileLink={handleResolveLocalFileLink}
            onOpenLocalFileLink={handleOpenLocalFileLink}
            onPendingModifiersConsumed={handlePendingModifiersConsumed}
            pendingModifiers={modifiers}
            focusRequestToken={focusRequestToken}
            resizeRequestToken={resizeRequestToken}
          />
        </div>

        {showLoadingOverlay ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/16"
            data-testid="terminal-attach-loading"
          >
            <Spinner className="size-4" style={mutedTextStyle} />
          </div>
        ) : null}

        {showFloatingCopyAction ? (
          <div className="absolute right-3 bottom-12 z-2">
            <TerminalFloatingCopyAction hasSelection={hasSelection} onCopy={handleTerminalCopy} />
          </div>
        ) : null}
      </div>

      {streamError ? (
        <div className="border-t px-3 py-1" style={errorRowStyle}>
          <span className="line-clamp-2 text-xs" style={errorTextStyle}>
            {streamError}
          </span>
        </div>
      ) : null}

      {isMobile ? (
        <div className="border-t p-2" style={keyboardStyle} data-testid="terminal-virtual-keyboard">
          <div className="flex flex-col gap-1">
            {TERMINAL_VIRTUAL_KEYBOARD_ROWS.map((row) => (
              <div
                key={row.map(getTerminalVirtualKeyboardControlId).join(":")}
                className="flex items-center gap-1"
              >
                {row.map(renderVirtualKeyboardControl)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
