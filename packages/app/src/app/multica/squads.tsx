import type { ReactElement } from "react";
import { useLocalSearchParams } from "expo-router";

import { SquadsPage } from "@/multica/multica-squads";

export default function MulticaSquadsRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return <SquadsPage serverId={serverId} />;
}
