/**
 * Builds the daemon setup commands shown in the setup guide modal.
 *
 * The commands are platform-independent (npm + byspace CLI), so a single
 * variant per guide is enough. `webOrigin` is the origin of the web app the
 * user is looking at right now; `relayEndpoint` is the user's self-hosted
 * relay, when they have one.
 */
export interface SetupCommandsInput {
  /** null on the hosted web app: onboard needs no --web-origin flag. */
  webOrigin: string | null;
  relayEndpoint?: string | null;
}

export interface SetupCommands {
  installCommand: string;
  onboardCommand: string;
}

export function buildSetupCommands(input: SetupCommandsInput): SetupCommands {
  // --relay-endpoint implies relay; plain --relay selects the hosted relay.
  const onboardFlags: string[] = [];
  if (input.webOrigin) {
    onboardFlags.push("--web-origin", input.webOrigin);
  }
  if (input.relayEndpoint) {
    onboardFlags.push("--relay-endpoint", input.relayEndpoint);
  } else {
    onboardFlags.push("--relay");
  }
  return {
    installCommand: "npm install -g @bytetrue/byspace",
    onboardCommand: `byspace onboard ${onboardFlags.join(" ")}`,
  };
}
