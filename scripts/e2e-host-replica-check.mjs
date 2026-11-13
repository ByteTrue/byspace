// End-to-end check of the host replica against a real daemon, using the client the app ships.
//
// It proves the whole chain the unit tests can only imitate: permission for hosts.sync.exchange,
// the record round trip, per-record merge, tombstones and the 256 KB rejection.
import { DaemonClient } from "../packages/client/dist/daemon-client.js";

const url = process.env.DAEMON_URL ?? "ws://127.0.0.1:6799/ws";
const client = new DaemonClient({ url, appVersion: "0.25.0", clientId: "e2e_host_replica" });
await client.connect();

const host = (id, label) => ({
  kind: "host",
  id,
  data: {
    label,
    connections: [
      {
        id: `relay:${id}`,
        type: "relay",
        relayEndpoint: "relay.example:443",
        daemonPublicKeyB64: "pk",
      },
    ],
  },
});

const first = await client.exchangeHostSync({
  changes: [host("srv_a", "Laptop"), host("srv_b", "VPS")],
});
console.log(`write two hosts: ${first.error ?? "ok"}, records=${first.records?.length ?? 0}`);

const second = await client.exchangeHostSync({});
const labels = (second.records ?? [])
  .filter((record) => record.kind === "host" && !record.deleted)
  .map((record) => record.data?.label);
console.log(`read back: ${labels.join(", ")}`);

const removed = await client.exchangeHostSync({
  changes: [{ kind: "host", id: "srv_b", delete: true }],
});
const alive = (removed.records ?? [])
  .filter((record) => record.kind === "host" && !record.deleted)
  .map((record) => record.id);
console.log(`after delete: ${alive.join(", ")}`);

const tombstoned = (removed.records ?? []).find((record) => record.id === "srv_b");
console.log(`tombstone kept: ${tombstoned?.deleted === true}`);

const withPassword = await client.exchangeHostSync({
  changes: [{ kind: "host", id: "srv_c", data: { label: "Leaky", password: "hunter2" } }],
});
console.log(`credential record refused: ${Boolean(withPassword.error)}`);

// A carried record from another replica merges in and comes back, which is how the chain converges
// through the browser.
const carried = {
  kind: "host",
  id: "srv_remote",
  version: 99,
  author: "srv_remote",
  data: { label: "Remote", connections: [] },
};
const merged = await client.exchangeHostSync({ records: [carried] });
console.log(
  `carried record merged: ${(merged.records ?? []).some((record) => record.id === "srv_remote")}`,
);

const oversized = await client.exchangeHostSync({
  changes: [{ kind: "host", id: "srv_big", data: { label: "x".repeat(300 * 1024) } }],
});
console.log(`oversized record refused: ${Boolean(oversized.error)}`);

await client.close();
process.exit(0);
