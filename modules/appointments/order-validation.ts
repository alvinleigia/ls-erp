import { z } from "zod"

export const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["DRAFT", "CONFIRMED", "COMPLETED", "CANCELED"]).optional(),
  customerId: z.string().trim().optional(),
})
export type OrderListInput = z.infer<typeof orderListSchema>
