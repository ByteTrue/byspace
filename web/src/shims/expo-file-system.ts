// Stand-in for expo-file-system. The app's file system is native storage; on the web every caller
// takes its browser branch first (stores/download-store.ts triggers a browser download), so nothing
// here is reached. Anything that is, fails loudly.
function unavailable(name: string): never {
  throw new Error(`expo-file-system ${name} is not available on the web`);
}

export class Directory {
  readonly uri: string;
  constructor(...parts: (Directory | string)[]) {
    this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
  }
}

export class File {
  readonly uri: string;
  constructor(...parts: (Directory | File | string)[]) {
    this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
  }
  get exists(): boolean {
    return unavailable("File.exists");
  }
  write(_content: string | Uint8Array): void {
    unavailable("File.write");
  }
}

export const Paths: { cache: Directory | null; document: Directory | null } = {
  cache: null,
  document: null,
};
