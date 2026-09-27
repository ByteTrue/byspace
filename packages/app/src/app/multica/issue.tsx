import { type ReactElement } from "react";

import { MulticaIssueDetail } from "@/multica/multica-issue-detail";
import { useLocalSearchParams } from "expo-router";

/** The issue detail route — thin, the detail view owns the layout. */
export default function MulticaIssueRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string; issueId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const issueId = typeof params.issueId === "string" ? params.issueId : "";
  return <MulticaIssueDetail serverId={serverId} issueId={issueId} />;
}
