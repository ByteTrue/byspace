export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type {
  Transport,
  TransportMessage,
  EncryptedChannelEvents,
} from "./encrypted-channel.js";
export {
  RELAY_CLIENT_AUTH_SCHEME,
  generateClientAuthChallenge,
  createClientAuthProof,
  verifyClientAuthProof,
} from "./client-auth.js";
export type { RelayClientAuthentication, RelayClientAuthProof } from "./client-auth.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
} from "./crypto.js";
export type { KeyPair, SharedKey } from "./crypto.js";
