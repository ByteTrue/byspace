import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import { buildForgeSearchQueryOptions, type ForgeSearchClient } from "@/git/use-forge-search-query";
import { extractGithubRefs, type GithubRef } from "@/utils/github-refs";
import type { ForgeSearchItem } from "@bytetrue/byspace-protocol/messages";
import { isAttachmentSelectedForGithubItem, toggleGithubAttachment } from "../actions";

const AUTO_ATTACH_DEBOUNCE_MS = 300;
const forgeClientGenerations = new WeakMap<ForgeSearchClient, number>();
let nextForgeClientGeneration = 1;

interface ComposerGithubAutoAttachInput {
  text: string;
  remoteUrl: string | null | undefined;
  attachments: UserComposerAttachment[];
  client: ForgeSearchClient | null;
  isConnected: boolean;
  serverId: string;
  cwd: string;
  supportsForgeSearch?: boolean;
  setAttachments: Dispatch<SetStateAction<UserComposerAttachment[]>>;
  onPullRequestDetected?: () => void;
  onPullRequestAdded?: (item: ForgeSearchItem) => void;
}

interface ComposerGithubAutoAttachResult {
  isResolving: boolean;
  markGithubAttachmentRemoved: (attachment: ComposerAttachment | undefined) => void;
}

export function useComposerGithubAutoAttach(
  params: ComposerGithubAutoAttachInput,
): ComposerGithubAutoAttachResult {
  const queryClient = useQueryClient();
  const latestRef = useRef(params);
  const removedRefKeysRef = useRef(new Set<string>());
  const pendingRefKeysRef = useRef(new Map<string, ForgeSearchClient>());
  const presentPullRequestKeysRef = useRef(new Set<string>());
  const previousTargetRef = useRef({ serverId: params.serverId, cwd: params.cwd });
  const [resolvingRefCounts, setResolvingRefCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  latestRef.current = params;

  useEffect(() => {
    suppressRefsCarriedAcrossTargets({
      params: latestRef.current,
      previousTargetRef,
      removedRefKeys: removedRefKeysRef.current,
    });
    notifyNewPullRequestRefs({
      params: latestRef.current,
      presentPullRequestKeysRef,
    });
    const refs = refsReadyForLookup({
      params: latestRef.current,
      removedRefKeys: removedRefKeysRef.current,
      pendingRefKeys: pendingRefKeysRef.current,
    });
    if (refs.length === 0) {
      return;
    }

    const refKeys = refs.map(githubRefKey);
    setResolvingRefCounts((current) => addKeys(current, refKeys));
    let resolvingReleased = false;
    const releaseResolving = () => {
      if (resolvingReleased) return;
      resolvingReleased = true;
      clearResolvingKeys(setResolvingRefCounts, refKeys);
    };

    const timerId = setTimeout(() => {
      void attachRefs({
        refs,
        queryClient,
        latestRef,
        removedRefKeys: removedRefKeysRef.current,
        pendingRefKeys: pendingRefKeysRef.current,
      }).finally(releaseResolving);
    }, AUTO_ATTACH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timerId);
      releaseResolving();
    };
  }, [
    params.text,
    params.remoteUrl,
    params.attachments,
    params.client,
    params.isConnected,
    params.serverId,
    params.cwd,
    params.supportsForgeSearch,
    queryClient,
  ]);

  const markGithubAttachmentRemoved = useCallback((attachment: ComposerAttachment | undefined) => {
    const key = attachmentKey(attachment);
    if (key) {
      removedRefKeysRef.current.add(key);
    }
  }, []);

  return useMemo(
    () => ({
      isResolving: resolvingRefCounts.size > 0,
      markGithubAttachmentRemoved,
    }),
    [markGithubAttachmentRemoved, resolvingRefCounts.size],
  );
}

function suppressRefsCarriedAcrossTargets({
  params,
  previousTargetRef,
  removedRefKeys,
}: {
  params: ComposerGithubAutoAttachInput;
  previousTargetRef: RefObject<{ serverId: string; cwd: string }>;
  removedRefKeys: Set<string>;
}): void {
  const previous = previousTargetRef.current;
  const targetChanged =
    previous.cwd.trim().length > 0 &&
    params.cwd.trim().length > 0 &&
    (previous.serverId !== params.serverId || previous.cwd !== params.cwd);
  previousTargetRef.current = { serverId: params.serverId, cwd: params.cwd };
  if (!targetChanged) return;

  for (const ref of extractGithubRefs(params.text, params.remoteUrl)) {
    removedRefKeys.add(githubRefKey(ref));
  }
}

function notifyNewPullRequestRefs({
  params,
  presentPullRequestKeysRef,
}: {
  params: ComposerGithubAutoAttachInput;
  presentPullRequestKeysRef: RefObject<Set<string>>;
}): void {
  const currentKeys = new Set(
    extractGithubRefs(params.text, params.remoteUrl)
      .filter((ref) => ref.kind === "pull")
      .map(githubRefKey),
  );
  for (const key of currentKeys) {
    if (!presentPullRequestKeysRef.current.has(key)) {
      params.onPullRequestDetected?.();
    }
  }
  presentPullRequestKeysRef.current = currentKeys;
}

function addKeys(
  current: ReadonlyMap<string, number>,
  keys: readonly string[],
): ReadonlyMap<string, number> {
  const nextCounts = new Map(current);
  for (const key of keys) nextCounts.set(key, (nextCounts.get(key) ?? 0) + 1);
  return nextCounts;
}

function removeKeys(
  current: ReadonlyMap<string, number>,
  keys: readonly string[],
): ReadonlyMap<string, number> {
  const next = new Map(current);
  for (const key of keys) {
    const count = next.get(key) ?? 0;
    if (count <= 1) next.delete(key);
    else next.set(key, count - 1);
  }
  return next;
}

function clearResolvingKeys(
  setResolvingRefCounts: Dispatch<SetStateAction<ReadonlyMap<string, number>>>,
  keys: readonly string[],
): void {
  setResolvingRefCounts((current) => removeKeys(current, keys));
}

async function attachRefs({
  refs,
  queryClient,
  latestRef,
  removedRefKeys,
  pendingRefKeys,
}: {
  refs: GithubRef[];
  queryClient: QueryClient;
  latestRef: RefObject<ComposerGithubAutoAttachInput>;
  removedRefKeys: Set<string>;
  pendingRefKeys: Map<string, ForgeSearchClient>;
}): Promise<void> {
  for (const ref of refs) {
    const key = githubRefKey(ref);
    const owner = latestRef.current.client;
    if (!owner || pendingRefKeys.get(key) === owner) {
      continue;
    }
    pendingRefKeys.set(key, owner);
    try {
      await attachRef({ ref, key, queryClient, latestRef, removedRefKeys });
    } finally {
      if (pendingRefKeys.get(key) === owner) {
        pendingRefKeys.delete(key);
      }
    }
  }
}

async function attachRef({
  ref,
  key,
  queryClient,
  latestRef,
  removedRefKeys,
}: {
  ref: GithubRef;
  key: string;
  queryClient: QueryClient;
  latestRef: RefObject<ComposerGithubAutoAttachInput>;
  removedRefKeys: Set<string>;
}): Promise<void> {
  const snapshot = latestRef.current;
  if (!snapshot.client || !snapshot.isConnected || !isRefStillPresent(ref, snapshot)) {
    return;
  }

  const search = await fetchGithubRefSearch({ ref, snapshot, queryClient });
  if (!search) {
    return;
  }
  const item = search.items.find((candidate) => githubItemMatchesRef(candidate, ref));
  const current = latestRef.current;
  if (
    !item ||
    removedRefKeys.has(key) ||
    !isSameLookupTarget(snapshot, current) ||
    !isRefStillPresent(ref, current)
  ) {
    return;
  }

  if (isAttachmentSelectedForGithubItem(current.attachments, item)) {
    return;
  }
  current.setAttachments((attachments) => {
    if (removedRefKeys.has(key) || isAttachmentSelectedForGithubItem(attachments, item)) {
      return attachments;
    }
    return toggleGithubAttachment(attachments, item);
  });
  if (item.kind === "change_request") {
    current.onPullRequestAdded?.(item);
  }
}

function refsReadyForLookup({
  params,
  removedRefKeys,
  pendingRefKeys,
}: {
  params: ComposerGithubAutoAttachInput;
  removedRefKeys: Set<string>;
  pendingRefKeys: Map<string, ForgeSearchClient>;
}): GithubRef[] {
  if (!params.client || !params.isConnected || params.cwd.trim().length === 0) {
    return [];
  }

  return extractGithubRefs(params.text, params.remoteUrl).filter((ref) => {
    const key = githubRefKey(ref);
    return (
      !removedRefKeys.has(key) &&
      pendingRefKeys.get(key) !== params.client &&
      !hasGithubAttachment(params.attachments, ref)
    );
  });
}

async function fetchGithubRefSearch({
  ref,
  snapshot,
  queryClient,
}: {
  ref: GithubRef;
  snapshot: ComposerGithubAutoAttachInput;
  queryClient: QueryClient;
}) {
  if (!snapshot.client) {
    return null;
  }

  try {
    const options = buildForgeSearchQueryOptions({
      client: snapshot.client,
      serverId: snapshot.serverId,
      cwd: snapshot.cwd,
      query: String(ref.number),
      supportsForgeSearch: snapshot.supportsForgeSearch,
      enabled: true,
    });
    return await queryClient.fetchQuery({
      ...options,
      queryKey: [...options.queryKey, "client", forgeClientGeneration(snapshot.client)],
    });
  } catch {
    return null;
  }
}

function isRefStillPresent(ref: GithubRef, params: ComposerGithubAutoAttachInput): boolean {
  return extractGithubRefs(params.text, params.remoteUrl).some(
    (candidate) => githubRefKey(candidate) === githubRefKey(ref),
  );
}

function isSameLookupTarget(
  initial: ComposerGithubAutoAttachInput,
  current: ComposerGithubAutoAttachInput,
): boolean {
  return (
    initial.serverId === current.serverId &&
    initial.cwd === current.cwd &&
    initial.remoteUrl === current.remoteUrl
  );
}

function forgeClientGeneration(client: ForgeSearchClient): number {
  const existing = forgeClientGenerations.get(client);
  if (existing !== undefined) return existing;
  const generation = nextForgeClientGeneration++;
  forgeClientGenerations.set(client, generation);
  return generation;
}

function hasGithubAttachment(attachments: UserComposerAttachment[], ref: GithubRef): boolean {
  return attachments.some((attachment) => attachmentKey(attachment) === githubRefKey(ref));
}

function githubItemMatchesRef(item: ForgeSearchItem, ref: GithubRef): boolean {
  return forgeItemKey(item) === githubRefKey(ref);
}

function githubItemKind(ref: GithubRef): ForgeSearchItem["kind"] {
  return ref.kind === "pull" ? "change_request" : "issue";
}

function githubRefKey(ref: GithubRef): string {
  return `${githubItemKind(ref)}:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}:${ref.number}`;
}

function attachmentKey(attachment: ComposerAttachment | undefined): string | null {
  if (
    !attachment ||
    attachment.kind === "image" ||
    (attachment.kind !== "forge_change_request" &&
      attachment.kind !== "forge_issue" &&
      attachment.kind !== "github_pr" &&
      attachment.kind !== "github_issue")
  ) {
    return null;
  }
  return forgeItemKey(attachment.item);
}

function forgeItemKey(item: ForgeSearchItem): string {
  const kind = item.kind;
  try {
    const url = new URL(item.url);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/\d+/u);
    if (url.hostname.toLowerCase() === "github.com" && match?.[1] && match[2]) {
      return `${kind}:${match[1].toLowerCase()}/${match[2].toLowerCase()}:${item.number}`;
    }
  } catch {
    // Keep compatibility with non-URL legacy fixture values.
  }
  return `${kind}:${item.number}`;
}
