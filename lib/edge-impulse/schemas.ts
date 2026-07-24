import { z } from "zod";

export const looseObjectSchema = z.record(z.unknown());

export const edgeImpulsePayloadSchema = z
  .object({
    success: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export function parseEdgeImpulsePayload(payload: unknown): Record<string, unknown> {
  const parsed = edgeImpulsePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Dữ liệu Edge Impulse không đúng cấu trúc: payload phải là một object JSON.");
  }
  if (parsed.data.success === false) {
    throw new Error(parsed.data.error || "Edge Impulse trả về trạng thái không thành công.");
  }
  return parsed.data;
}
