import type { TerminalSession } from "./terminal.js";

interface TerminalSizeRequest {
  rows: number;
  cols: number;
  intent?: "claim" | "update";
}

const terminalSizeOwners = new WeakMap<TerminalSession, object>();
const terminalsBySizeOwner = new WeakMap<object, Set<TerminalSession>>();

export function applyTerminalSize(
  terminal: TerminalSession,
  owner: object,
  request: TerminalSizeRequest,
): boolean {
  const intent = resolveTerminalSizeIntent(request.intent);
  if (intent === "update" && terminalSizeOwners.get(terminal) !== owner) {
    return false;
  }

  if (intent === "claim") {
    const previousOwner = terminalSizeOwners.get(terminal);
    if (previousOwner !== owner) {
      if (previousOwner) {
        terminalsBySizeOwner.get(previousOwner)?.delete(terminal);
      }
      terminalSizeOwners.set(terminal, owner);
      const ownedTerminals = terminalsBySizeOwner.get(owner) ?? new Set<TerminalSession>();
      ownedTerminals.add(terminal);
      terminalsBySizeOwner.set(owner, ownedTerminals);
    }
  }

  const currentSize = terminal.getSize();
  if (currentSize.rows !== request.rows || currentSize.cols !== request.cols) {
    terminal.send({ type: "resize", rows: request.rows, cols: request.cols });
  }
  return true;
}

export function releaseTerminalSizeOwnership(owner: object): void {
  const terminals = terminalsBySizeOwner.get(owner);
  if (!terminals) {
    return;
  }
  for (const terminal of terminals) {
    if (terminalSizeOwners.get(terminal) === owner) {
      terminalSizeOwners.delete(terminal);
    }
  }
  terminalsBySizeOwner.delete(owner);
}

function resolveTerminalSizeIntent(intent: TerminalSizeRequest["intent"]): "claim" | "update" {
  if (intent) {
    return intent;
  }
  // COMPAT(terminalSizeOwnership): added in v0.5.0, remove after 2027-02-08 once the client floor sends resize intent.
  return "claim";
}
