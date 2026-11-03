// crypto.randomUUID only exists in secure contexts. A daemon reached over plain http on the LAN is
// not one, and the client needs UUIDs; crypto.getRandomValues exists in every context.
type RandomUUID = `${string}-${string}-${string}-${string}-${string}`;

function createUuidV4(crypto: Pick<Crypto, "getRandomValues">): RandomUUID {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}` as RandomUUID;
}

export function installCryptoPolyfills(crypto: Crypto): void {
  if (typeof crypto.randomUUID === "function") return;
  crypto.randomUUID = () => createUuidV4(crypto);
}
