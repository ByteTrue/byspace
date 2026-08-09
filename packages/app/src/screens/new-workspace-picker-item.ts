import type { CreateBySpaceWorktreeInput } from "@bytetrue/byspace-client/internal/daemon-client";
import type { ForgeSearchItem } from "@bytetrue/byspace-protocol/messages";

export type PickerItem =
  | { kind: "branch"; name: string; refName?: string }
  | {
      kind: "github-pr";
      item: ForgeSearchItem;
    };

export type PickerCheckoutRequest = Pick<
  CreateBySpaceWorktreeInput,
  "action" | "refName" | "checkoutSource" | "githubPrNumber"
>;

export function pickerItemToCheckoutRequest(
  item: PickerItem | null,
): PickerCheckoutRequest | undefined {
  if (!item) return undefined;
  switch (item.kind) {
    case "branch":
      return { action: "branch-off", refName: item.refName ?? item.name };
    case "github-pr": {
      const headRefName = item.item.headRefName?.trim();
      const forge = item.item.forge ?? "github";
      return {
        action: "checkout",
        ...(headRefName ? { refName: headRefName } : {}),
        checkoutSource: {
          kind: "change_request",
          forge,
          number: item.item.number,
          ...(item.item.projectPath ? { projectPath: item.item.projectPath } : {}),
        },
        ...(forge === "github"
          ? {
              // COMPAT(githubPrNumber): added in v0.1.106, remove after 2026-12-28 once
              // daemon floor parses checkoutSource.
              githubPrNumber: item.item.number,
            }
          : {}),
      };
    }
  }
}

export interface BaseRefCheckoutStatus {
  currentBranch: string | null;
  upstreamRef?: string | null;
}

function branchNameFromRef(refName: string): string {
  if (refName.startsWith("refs/heads/")) return refName.slice("refs/heads/".length);
  if (refName.startsWith("refs/remotes/")) {
    const remainder = refName.slice("refs/remotes/".length);
    const separator = remainder.indexOf("/");
    return separator === -1 ? remainder : remainder.slice(separator + 1);
  }
  return refName;
}

export function defaultBasePickerItem(status: BaseRefCheckoutStatus): PickerItem | null {
  if (!status.currentBranch) return null;
  // COMPAT(checkoutUpstreamRef): added in v0.4.0, remove after 2027-02-01 once the daemon
  // floor sends upstreamRef. Older daemons omit it, which preserves the previous local base.
  const refName = status.upstreamRef ?? `refs/heads/${status.currentBranch}`;
  return { kind: "branch", name: branchNameFromRef(refName), refName };
}

export function resolveCheckoutRequest(
  selectedItem: PickerItem | null,
  status: BaseRefCheckoutStatus,
): PickerCheckoutRequest | undefined {
  return pickerItemToCheckoutRequest(selectedItem ?? defaultBasePickerItem(status));
}
