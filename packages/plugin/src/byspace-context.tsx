import type { BySpaceApi } from "@bytetrue/byspace-client";
import { createContext, useContext, type ReactNode } from "react";

const BySpaceApiContext = createContext<BySpaceApi | null>(null);

export function BySpaceApiProvider({
  children,
  byspace,
}: {
  children: ReactNode;
  byspace: BySpaceApi;
}) {
  return <BySpaceApiContext.Provider value={byspace}>{children}</BySpaceApiContext.Provider>;
}

export function useBySpace(): BySpaceApi {
  const byspace = useContext(BySpaceApiContext);
  if (!byspace) throw new Error("useBySpace must run inside a contributed plugin surface");
  return byspace;
}
