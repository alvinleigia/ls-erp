import { z } from "zod"

const id = z.string().trim().min(1).max(200)
const name = z.string().trim().min(1).max(160)
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, "Use up to 32 letters, numbers, underscores or hyphens.")
const parentId = id.nullable()
export const companyCreateSchema = z.object({ name, code, parentId: parentId.default(null) }).strict()
export const companyUpdateSchema = z.object({ name: name.optional(), parentId: parentId.optional(), archived: z.boolean().optional(), version: z.number().int().positive() }).strict()
export const officeCreateSchema = z.object({ name, code, companyId: id }).strict()
export const officeUpdateSchema = z.object({ name: name.optional(), archived: z.boolean().optional(), version: z.number().int().positive() }).strict()
export const structureQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(160).default(""),
  sort: z.enum(["name", "code", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  status: z.enum(["active", "archived", "all"]).default("active"),
  companyId: id.optional(),
}).strict()

export type Company = {
  id: string; code: string; name: string; parentId: string | null;
  isInitial: boolean; archived: boolean; version: number;
  parent: { id: string; code: string; name: string } | null;
}
export type Office = {
  id: string; code: string; name: string; companyId: string;
  isInitial: boolean; archived: boolean; version: number;
  company: { id: string; code: string; name: string };
}
