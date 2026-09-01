export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requireOptionalNativeModule<T>(): T | null {
  return null;
}
