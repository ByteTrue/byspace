import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../server/messages.js";
import type { CollabSliceStore } from "./store.js";

export interface CollabSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface CollabSessionOptions {
  host: CollabSessionHost;
  store: CollabSliceStore;
  logger: pino.Logger;
}

export class CollabSession {
  private readonly host: CollabSessionHost;
  private readonly store: CollabSliceStore;
  private readonly logger: pino.Logger;

  constructor(options: CollabSessionOptions) {
    this.host = options.host;
    this.store = options.store;
    this.logger = options.logger;
  }

  async handleCollabSliceCreateRequest(
    request: Extract<SessionInboundMessage, { type: "collab.slice.create.request" }>,
  ): Promise<void> {
    try {
      const record = await this.store.create({ title: request.title });
      this.host.emit({
        type: "collab.slice.create.response",
        payload: { requestId: request.requestId, record, error: null },
      });
    } catch (error) {
      this.emitCollabRpcError(request.type, request.requestId, error);
    }
  }

  async handleCollabSliceListRequest(
    request: Extract<SessionInboundMessage, { type: "collab.slice.list.request" }>,
  ): Promise<void> {
    try {
      const records = await this.store.list();
      this.host.emit({
        type: "collab.slice.list.response",
        payload: { requestId: request.requestId, records, error: null },
      });
    } catch (error) {
      this.emitCollabRpcError(request.type, request.requestId, error);
    }
  }

  private emitCollabRpcError(requestType: string, requestId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error({ err: error, requestType }, "Collab request failed");
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId,
        requestType,
        error: message,
        code: "collab_request_failed",
      },
    });
  }
}
