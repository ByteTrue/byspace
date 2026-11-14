/**
 * Relay connection types and interfaces.
 *
 * The relay bridges two WebSocket connections:
 * - Server (daemon): The BySpace server connecting to the relay
 * - Client (app): The mobile/web app connecting to the relay
 *
 * Messages are forwarded bidirectionally without modification.
 */

export type ConnectionRole = "server" | "client";

export interface RelaySessionAttachment {
  serverId: string;
  role: ConnectionRole;
  /**
   * Unique id for the connection. Allows the daemon to create an
   * independent socket + E2EE channel per connected connection.
   */
  connectionId?: string | null;
  createdAt: number;
}
