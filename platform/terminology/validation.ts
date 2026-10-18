import { z } from "zod"

export const terminologyUpdateSchema = z.object({
  version: z.number().int().min(0).max(2147483646),
  changes: z.array(z.object({ key: z.string().min(1).max(100), label: z.string().max(200).nullable() }).strict()).min(1).max(100),
}).strict()
