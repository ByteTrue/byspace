/**
 * Unit tests for the runtime-agnostic relay session core. The Cloudflare
 * adapter's suite (cloudflare-adapter.test.ts) covers these same behaviors on
 * the Durable Object; these keep the Node relay honest on the parts a
 * wire-level e2e cannot reach cheaply (timer-driven nudge/reset, buffer cap).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { RelaySession, type RelaySocket } from "./relay-session.js";
import type { ConnectionRole, RelaySessionAttachment } from "./types.js";

function mockSocket(): RelaySocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { send: vi.fn(), close: vi.fn() };
}

function attachment(role: ConnectionRole, connectionId: string | null): RelaySessionAttachment {
  return { serverId: "srv_test", role, version: "2", connectionId, createdAt: Date.now() };
}

describe("RelaySession control nudge/reset", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("nudges control, then force-closes it when no server data socket appears", () => {
    vi.useFakeTimers();
    const connectionId = "clt_waiting_for_daemon";
    const control = mockSocket();
    const client = mockSocket();
    const session = new RelaySession<RelaySocket>();
    session.add(control, ["server-control"], attachment("server", null));
    session.add(client, ["client", `client:${connectionId}`], attachment("client", connectionId));

    session.nudgeOrResetControlForConnection(connectionId);

    vi.advanceTimersByTime(10_000);
    expect(control.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(control.send.mock.calls[0][0] as string)).toEqual({
      type: "sync",
      connectionIds: [connectionId],
    });

    vi.advanceTimersByTime(5_000);
    expect(control.close).toHaveBeenCalledWith(1011, "Control unresponsive");
  });

  it("does not nudge or reset control after the client already disconnected", () => {
    vi.useFakeTimers();
    const control = mockSocket();
    const session = new RelaySession<RelaySocket>();
    session.add(control, ["server-control"], attachment("server", null));

    session.nudgeOrResetControlForConnection("clt_gone");
    vi.advanceTimersByTime(15_000);

    expect(control.send).not.toHaveBeenCalled();
    expect(control.close).not.toHaveBeenCalled();
  });

  it("does not reset control when the server data socket arrived meanwhile", () => {
    vi.useFakeTimers();
    const connectionId = "clt_data_arrived";
    const control = mockSocket();
    const client = mockSocket();
    const serverData = mockSocket();
    const session = new RelaySession<RelaySocket>();
    session.add(control, ["server-control"], attachment("server", null));
    session.add(client, ["client", `client:${connectionId}`], attachment("client", connectionId));
    session.add(
      serverData,
      ["server", `server:${connectionId}`],
      attachment("server", connectionId),
    );

    session.nudgeOrResetControlForConnection(connectionId);
    vi.advanceTimersByTime(15_000);

    expect(control.send).not.toHaveBeenCalled();
    expect(control.close).not.toHaveBeenCalled();
  });

  it("skips the reset when the client disconnects between the two timers", () => {
    vi.useFakeTimers();
    const connectionId = "clt_left_midway";
    const control = mockSocket();
    const client = mockSocket();
    const session = new RelaySession<RelaySocket>();
    session.add(control, ["server-control"], attachment("server", null));
    session.add(client, ["client", `client:${connectionId}`], attachment("client", connectionId));

    session.nudgeOrResetControlForConnection(connectionId);
    vi.advanceTimersByTime(10_000);
    expect(control.send).toHaveBeenCalledTimes(1);

    session.remove(client);
    vi.advanceTimersByTime(5_000);
    expect(control.close).not.toHaveBeenCalled();
  });
});

describe("RelaySession frame buffering", () => {
  it("caps buffered frames and drops the oldest first", () => {
    const connectionId = "clt_flood";
    const serverData = mockSocket();
    const session = new RelaySession<RelaySocket>();

    for (let i = 0; i < 250; i += 1) session.bufferFrame(connectionId, `frame-${i}`);
    session.flushFrames(connectionId, serverData);

    expect(serverData.send).toHaveBeenCalledTimes(200);
    expect(serverData.send.mock.calls[0][0]).toBe("frame-50");
    expect(serverData.send.mock.calls[199][0]).toBe("frame-249");
  });

  it("drops buffered frames when the last client disconnects", () => {
    const connectionId = "clt_discard";
    const serverData = mockSocket();
    const session = new RelaySession<RelaySocket>();

    session.bufferFrame(connectionId, "stale");
    session.dropBufferedFrames(connectionId);
    session.flushFrames(connectionId, serverData);

    expect(serverData.send).not.toHaveBeenCalled();
  });
});
