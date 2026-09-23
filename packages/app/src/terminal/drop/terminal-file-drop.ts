const DANGEROUS_NON_WINDOWS_PATH_CHARS = /[`$|&>~#!^*;<]/g;

function getLegacyFilePath(file: File): string | null {
  const path = Reflect.get(file, "path");
  return typeof path === "string" && path.length > 0 ? path : null;
}

export function isTerminalFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}

interface ContainsTarget {
  contains: (other: EventTarget | null) => boolean;
}

function asContainsTarget(value: EventTarget | null): ContainsTarget | null {
  if (!value || typeof (value as Partial<ContainsTarget>).contains !== "function") {
    return null;
  }
  return value as unknown as ContainsTarget;
}

export function isTerminalDragLeaveOutside(input: {
  currentTarget: EventTarget | null;
  relatedTarget: EventTarget | null;
}): boolean {
  const currentTarget = asContainsTarget(input.currentTarget);
  if (!currentTarget || !input.relatedTarget) {
    return true;
  }
  return !currentTarget.contains(input.relatedTarget);
}

export function extractTerminalDropPaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) {
    return [];
  }

  const paths: string[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    const path = getLegacyFilePath(file);
    if (path) {
      paths.push(path);
    }
  }
  return paths;
}

function escapeNonWindowsPath(path: string): string {
  let nextPath = path;
  if (nextPath.includes("\\")) {
    nextPath = nextPath.replace(/\\/g, "\\\\");
  }

  nextPath = nextPath.replace(DANGEROUS_NON_WINDOWS_PATH_CHARS, "");

  if (nextPath.includes("'") && nextPath.includes('"')) {
    return `$'${nextPath.replace(/'/g, "\\'")}'`;
  }
  if (nextPath.includes("'")) {
    return `'${nextPath.replace(/'/g, "\\'")}'`;
  }
  return `'${nextPath}'`;
}

export function prepareDroppedPathForTerminal(path: string): string {
  return escapeNonWindowsPath(path);
}

export function prepareDroppedPathsForTerminal(paths: readonly string[]): string {
  return paths.map((path) => prepareDroppedPathForTerminal(path)).join(" ");
}
