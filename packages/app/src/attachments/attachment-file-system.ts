export type AttachmentFileInfo =
  | { exists: true; isDirectory: boolean; size: number | null }
  | { exists: false };

export interface AttachmentFileSystem {
  readonly cacheDirectory: string | null;
  getInfo(uri: string): Promise<AttachmentFileInfo>;
  makeDirectory(uri: string, options: { intermediates: boolean }): Promise<void>;
  writeBytes(uri: string, bytes: Uint8Array): Promise<void>;
  copy(input: { from: string; to: string }): Promise<void>;
  readAsBase64(uri: string): Promise<string>;
  delete(uri: string, options: { idempotent: boolean }): Promise<void>;
  listDirectory(uri: string): Promise<string[]>;
}
