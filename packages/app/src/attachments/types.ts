import type {
  AgentAttachment,
  ForgeSearchItem,
  UploadedFileAttachment,
} from "@bytetrue/byspace-protocol/messages";

export type AttachmentStorageType = "web-indexeddb";

export interface AttachmentMetadata {
  id: string;
  mimeType: string;
  storageType: AttachmentStorageType;
  /** IndexedDB object store key. */
  storageKey: string;
  fileName?: string | null;
  byteSize?: number | null;
  createdAt: number;
}

export type PullRequestContextAttachmentKind =
  | "forge.change_request_comment"
  | "forge.change_request_review"
  | "forge.change_request_check"
  | "github.pull_request_comment"
  | "github.pull_request_review"
  | "github.pull_request_check";

interface PullRequestContextAttachmentFields {
  id: string;
  title: string;
  subtitle?: string;
  text: string;
  url?: string | null;
}

export type PullRequestContextAttachment =
  | ({ kind: "forge.change_request_comment" } & PullRequestContextAttachmentFields)
  | ({ kind: "forge.change_request_review" } & PullRequestContextAttachmentFields)
  | ({ kind: "forge.change_request_check" } & PullRequestContextAttachmentFields)
  | ({ kind: "github.pull_request_comment" } & PullRequestContextAttachmentFields)
  | ({ kind: "github.pull_request_review" } & PullRequestContextAttachmentFields)
  | ({ kind: "github.pull_request_check" } & PullRequestContextAttachmentFields);

export interface ChatHistoryContextAttachment {
  kind: "chat_history";
  id: string;
  attachment: Extract<AgentAttachment, { type: "text" }>;
  source: {
    serverId: string;
    agentId: string;
    boundaryMessageId?: string | null;
    boundaryCursor?: { epoch: string; seq: number } | null;
    itemCount?: number;
  };
}

export const NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER = "new-workspace-picker";

export type UserComposerAttachment =
  | { kind: "image"; metadata: AttachmentMetadata }
  | { kind: "file"; attachment: UploadedFileAttachment }
  | { kind: "forge_issue"; item: ForgeSearchItem }
  | { kind: "forge_change_request"; item: ForgeSearchItem }
  // COMPAT(githubAttachmentKinds): added in v0.1.106, remove after 2026-12-28 once daemon floor >= v0.1.106
  | { kind: "github_issue"; item: ForgeSearchItem }
  | {
      kind: "github_pr";
      item: ForgeSearchItem;
      owner?: typeof NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER;
    };

export type WorkspaceComposerAttachment =
  | PullRequestContextAttachment
  | ChatHistoryContextAttachment
  | {
      kind: "review";
      attachment: Extract<AgentAttachment, { type: "review" }>;
      reviewDraftKey: string;
      commentCount: number;
    };

export type ComposerAttachment = UserComposerAttachment | WorkspaceComposerAttachment;

export type AttachmentDataSource =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "blob"; blob: Blob }
  | { kind: "data_url"; dataUrl: string }
  | { kind: "file_uri"; uri: string };

export interface SaveAttachmentInput {
  id?: string;
  mimeType?: string;
  fileName?: string | null;
  source: AttachmentDataSource;
}

export interface ResolvePreviewUrlInput {
  attachment: AttachmentMetadata;
}

export interface ReleasePreviewUrlInput {
  attachment: AttachmentMetadata;
  url: string;
}

export interface EncodeAttachmentInput {
  attachment: AttachmentMetadata;
}

export interface DeleteAttachmentInput {
  attachment: AttachmentMetadata;
}

export interface GarbageCollectInput {
  referencedIds: ReadonlySet<string>;
}

/** Async storage contract for IndexedDB attachment bytes. */
export interface AttachmentStore {
  readonly storageType: AttachmentStorageType;
  save(input: SaveAttachmentInput): Promise<AttachmentMetadata>;
  encodeBase64(input: EncodeAttachmentInput): Promise<string>;
  resolvePreviewUrl(input: ResolvePreviewUrlInput): Promise<string>;
  releasePreviewUrl?(input: ReleasePreviewUrlInput): Promise<void>;
  delete(input: DeleteAttachmentInput): Promise<void>;
  garbageCollect(input: GarbageCollectInput): Promise<void>;
}
