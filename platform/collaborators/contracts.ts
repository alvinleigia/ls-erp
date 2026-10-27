import { z } from "zod"
const id = z.string().trim().min(1).max(200)
const fields = z.object({
  name: z.string().trim().min(1).max(160),
  classification: z.string().trim().min(1).max(80),
  organizationName: z.string().trim().min(1).max(160).nullable(),
  email: z.string().trim().toLowerCase().email().max(254).nullable(),
  phone: z.string().trim().min(1).max(40).nullable(),
  supervisorUserId: id,
})
export const collaboratorCreateSchema = fields.extend({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
  classification: fields.shape.classification.default("Partner"),
  organizationName: fields.shape.organizationName.default(null),
  email: fields.shape.email.default(null), phone: fields.shape.phone.default(null),
}).strict()
export const collaboratorUpdateSchema = fields.partial().extend({ archived: z.boolean().optional(), version: z.number().int().positive() }).strict()
export const collaboratorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(160).default(""), sort: z.enum(["name", "code", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"), status: z.enum(["active", "archived", "all"]).default("active"),
}).strict()
export const supervisorQuerySchema = collaboratorQuerySchema.pick({ page: true, pageSize: true, q: true })
export type Collaborator = {
  id: string; code: string; name: string; classification: string; organizationName: string | null;
  email: string | null; phone: string | null; supervisorUserId: string; archived: boolean; version: number;
  supervisor: { id: string; name: string | null; email: string; role: string; status: string };
}
