import { z } from "zod";

/**
 * Minimal record for the collab validation slice (BYTE-6). One record per
 * `collab.slice.create` call — this is deliberately not a work-item entity;
 * P1 introduces the real collab entities.
 */
export const CollabSliceRecordSchema = z.object({
  id: z.guid(),
  title: z.string(),
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601
});
export type CollabSliceRecord = z.infer<typeof CollabSliceRecordSchema>;

export const CollabSliceCreateRequestSchema = z.object({
  type: z.literal("collab.slice.create.request"),
  requestId: z.string(),
  title: z.string().trim().min(1),
});
export type CollabSliceCreateRequest = z.infer<typeof CollabSliceCreateRequestSchema>;

export const CollabSliceCreateResponseSchema = z.object({
  type: z.literal("collab.slice.create.response"),
  payload: z.object({
    requestId: z.string(),
    record: CollabSliceRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});
export type CollabSliceCreateResponse = z.infer<typeof CollabSliceCreateResponseSchema>;

export const CollabSliceListRequestSchema = z.object({
  type: z.literal("collab.slice.list.request"),
  requestId: z.string(),
});
export type CollabSliceListRequest = z.infer<typeof CollabSliceListRequestSchema>;

export const CollabSliceListResponseSchema = z.object({
  type: z.literal("collab.slice.list.response"),
  payload: z.object({
    requestId: z.string(),
    records: z.array(CollabSliceRecordSchema),
    error: z.string().nullable(),
  }),
});
export type CollabSliceListResponse = z.infer<typeof CollabSliceListResponseSchema>;
