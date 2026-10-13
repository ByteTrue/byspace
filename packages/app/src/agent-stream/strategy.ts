import type { ComponentType, ReactElement, ReactNode, RefObject } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { StreamItem } from "@/types/stream";
import type { StreamHistoryBoundary, StreamRenderSegments } from "./model";
import type {
  BottomAnchorLocalRequest,
  BottomAnchorRouteRequest,
} from "./bottom-anchor-controller";

export type EdgeSlot = "header" | "footer";
export type NeighborRelation = "above" | "below";
export type StreamFrameChildOrder = "content-then-footer" | "footer-then-content";

export type MaintainVisibleContentPositionConfig = Readonly<{
  minIndexForVisible: number;
  autoscrollToTopThreshold: number;
}>;

export type BottomAnchorTransportBehavior = Readonly<{
  verificationDelayFrames: number;
  verificationRetryMode: "rescroll" | "recheck";
}>;

export interface StreamViewportMetrics {
  contentHeight: number;
  viewportHeight: number;
}

export type StreamNearBottomInput = StreamViewportMetrics & {
  offsetY: number;
  threshold: number;
};

export interface StreamEdgeSlotProps {
  ListHeaderComponent?: ReactElement | ComponentType<unknown> | null;
  ListHeaderComponentStyle?: StyleProp<ViewStyle>;
  ListFooterComponent?: ReactElement | ComponentType<unknown> | null;
  ListFooterComponentStyle?: StyleProp<ViewStyle>;
}

export interface StreamViewportHandle {
  scrollToBottom: (reason?: BottomAnchorLocalRequest["reason"]) => void;
  prepareForViewportChange: () => void;
  scrollToMessage?: (itemId: string) => void;
}

export interface StreamSegmentRenderers {
  renderHistoryVirtualizedRow: (item: StreamItem, index: number, items: StreamItem[]) => ReactNode;
  renderHistoryMountedRow: (item: StreamItem, index: number, items: StreamItem[]) => ReactNode;
  renderLiveHeadRow: (item: StreamItem, index: number, items: StreamItem[]) => ReactNode;
  renderLiveAuxiliary: () => ReactNode;
}

export interface StreamHistoryRowRevision {
  contentById: { has(id: string): boolean };
  displayStateById: { has(id: string): boolean };
  globalDisplayState: boolean;
}

export interface StreamRenderInput {
  agentId: string;
  segments: StreamRenderSegments;
  historyRowRevision?: StreamHistoryRowRevision;
  liveHeadRowRevision?: unknown;
  boundary: StreamHistoryBoundary;
  renderers: StreamSegmentRenderers;
  listEmptyComponent: ReactNode;
  viewportRef: RefObject<StreamViewportHandle | null>;
  routeBottomAnchorRequest: BottomAnchorRouteRequest | null;
  isAuthoritativeHistoryReady: boolean;
  onNearBottomChange: (value: boolean) => void;
  // The history row under the top of the viewport, for surfaces that mark where the reader
  // is in the transcript. Only the web viewport measures it today.
  onReadingPositionChange?: (rowId: string | null) => void;
  onNearHistoryStart: () => boolean | Promise<boolean>;
  isLoadingOlderHistory: boolean;
  hasOlderHistory: boolean;
  olderHistoryProgressKey: string | null;
  scrollEnabled: boolean;
  listStyle: StyleProp<ViewStyle>;
  baseListContentContainerStyle: StyleProp<ViewStyle>;
  forwardListContentContainerStyle: StyleProp<ViewStyle>;
}

export interface StreamStrategy {
  render: (input: StreamRenderInput) => ReactNode;
  orderTail: (streamItems: StreamItem[]) => StreamItem[];
  orderHead: (streamHead: StreamItem[]) => StreamItem[];
  getNeighborIndex: (index: number, relation: NeighborRelation) => number;
  getNeighborItem: (
    items: StreamItem[],
    index: number,
    relation: NeighborRelation,
  ) => StreamItem | undefined;
  collectAssistantResponseContent: (items: StreamItem[], startIndex: number) => string;
  isNearBottom: (input: StreamNearBottomInput) => boolean;
  getBottomOffset: (metrics: StreamViewportMetrics) => number;
  getEdgeSlotProps: (
    component: ReactElement | ComponentType<unknown> | null,
    gapSize: number,
  ) => StreamEdgeSlotProps;
  getMaintainVisibleContentPosition: () => MaintainVisibleContentPositionConfig | undefined;
  getBottomAnchorTransportBehavior: () => BottomAnchorTransportBehavior;
  getHistoryLiveBoundaryIndex: (history: StreamItem[]) => number | null;
  getLiveHeadHistoryBoundaryIndex: (liveHead: StreamItem[]) => number | null;
  getLatestItemIndex: (items: StreamItem[]) => number | null;
  getFrameChildOrder: () => StreamFrameChildOrder;
  getFlatListInverted: () => boolean;
  getOverlayScrollbarInverted: () => boolean;
  shouldAnchorBottomOnContentSizeChange: () => boolean;
  shouldAnimateManualScrollToBottom: () => boolean;
  shouldUseVirtualizedList: () => boolean;
}
