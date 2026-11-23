import type { CheckoutDiffUpdate, ParsedDiffFile } from "@bytetrue/protocol/messages";

type CheckoutError = CheckoutDiffUpdate["payload"]["error"];
import { DiffOpcode, type DiffFrame } from "@bytetrue/protocol/binary-frames/index";

// One comparison revision is delivered as Begin, Bodies, End. Files the daemon did not send kept
// their identity, so the cache retains their previous bodies instead of re-parsing or clearing
// them. This module owns no transport: the client feeds it frames and drains one payload per End.
export class DiffFrameAssembler {
  private pending = new Map<
    string,
    {
      header: Extract<DiffFrame, { opcode: typeof DiffOpcode.Begin }>["header"];
      bodies: Map<string, ParsedDiffFile>;
    }
  >();

  private retained = new Map<string, Map<string, ParsedDiffFile>>();

  push(frame: DiffFrame): {
    subscriptionId: string;
    payload: {
      cwd: string;
      files: ParsedDiffFile[];
      error: CheckoutError | null;
      diffTooLarge?: boolean;
    };
  } | null {
    switch (frame.opcode) {
      case DiffOpcode.Begin: {
        this.pending.set(frame.subscriptionId, {
          header: frame.header,
          bodies: new Map(),
        });
        return null;
      }
      case DiffOpcode.Bodies: {
        const pending = this.pending.get(frame.subscriptionId);
        if (!pending) {
          return null;
        }
        for (const file of frame.files) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(file.body)) as ParsedDiffFile;
            pending.bodies.set(file.path, parsed);
          } catch {
            // Drop the whole revision: falling back to the previous body here would show content
            // the daemon never sent for this revision.
            this.pending.delete(frame.subscriptionId);
            return null;
          }
        }
        return null;
      }
      case DiffOpcode.End: {
        const pending = this.pending.get(frame.subscriptionId);
        this.pending.delete(frame.subscriptionId);
        if (!pending || pending.header.revision !== frame.trailer.revision) {
          return null;
        }
        const previous =
          this.retained.get(frame.subscriptionId) ?? new Map<string, ParsedDiffFile>();
        const files: ParsedDiffFile[] = [];
        const next = new Map<string, ParsedDiffFile>();
        for (const path of pending.header.entries) {
          const file = pending.bodies.get(path) ?? previous.get(path);
          if (file) {
            files.push(file);
            next.set(path, file);
          }
        }
        this.retained.set(frame.subscriptionId, next);
        return {
          subscriptionId: frame.subscriptionId,
          payload: {
            cwd: pending.header.cwd,
            files,
            error: frame.trailer.error,
            ...(frame.trailer.diffTooLarge ? { diffTooLarge: true } : {}),
          },
        };
      }
      default:
        return null;
    }
  }

  forget(subscriptionId: string): void {
    this.pending.delete(subscriptionId);
    this.retained.delete(subscriptionId);
  }
}
