import type { ReactNode, ReactPortal } from "react";

declare module "react-dom" {
  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): ReactPortal;
  export function flushSync<R>(fn: () => R): R;
  export function flushSync(): void;
  const content: unknown;
  export default content;
}

declare module "react-dom/client" {
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment, options?: unknown): Root;
  export function hydrateRoot(
    container: Element | DocumentFragment,
    initialChildren: ReactNode,
    options?: unknown,
  ): Root;
}

declare module "react-dom/server" {
  export function renderToString(element: ReactNode): string;
  export function renderToStaticMarkup(element: ReactNode): string;
}
