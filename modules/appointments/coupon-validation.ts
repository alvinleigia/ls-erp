import { z } from "zod"

export const couponListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  active: z.enum(["true", "false"]).transform(value => value === "true").optional(),
})
export type CouponListInput = z.infer<typeof couponListSchema>
