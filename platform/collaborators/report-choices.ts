import { Prisma } from "@prisma/client"
import type { z } from "zod"
import type { attributionChoiceSchema } from "./report-validation"

// The caller supplies its already-authorized report population, with columns
// id, createdAt, partner and evidence. No collaborator-directory query is used.
export async function readAttributionChoices(tx: Prisma.TransactionClient, tenantId: string, sources: Prisma.Sql, query: z.infer<typeof attributionChoiceSchema>, page: number, pageSize: number) {
  const key = query.choice === "partner" ? Prisma.sql`partner` : Prisma.sql`supervisor`
  const name = query.choice === "partner" ? Prisma.sql`"partnerName"` : Prisma.sql`"supervisorName"`
  const cte = Prisma.sql`WITH visible_sources AS (${sources}), projected AS (
    SELECT s.id,s."createdAt",s.partner,s.evidence->>'supervisorUserId' AS supervisor,
      s.evidence->>'name'||' ('||(s.evidence->>'code')||')' AS "partnerName",
      COALESCE(NULLIF(btrim(u.name),''),CASE WHEN u.id IS NULL THEN 'Former supervisor' ELSE 'Unnamed supervisor' END) AS "supervisorName"
    FROM visible_sources s LEFT JOIN "User" u ON u."tenantId"=${tenantId} AND u.id=s.evidence->>'supervisorUserId'
  ), labels AS (
    SELECT DISTINCT ON (${key}) ${key} AS id,${name} AS name FROM projected
    WHERE ${key} IS NOT NULL ORDER BY ${key},"createdAt" DESC,projected.id
  ), choices AS (SELECT * FROM labels WHERE name ILIKE ${"%"+query.q+"%"} ${query.selectedId ? Prisma.sql`AND id=${query.selectedId}` : Prisma.empty})`
  const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${cte} SELECT COUNT(*)::int AS total FROM choices`)
  const items = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`${cte} SELECT * FROM choices ORDER BY name,id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`)
  return { items, total, page, pageSize, totalPages: Math.max(1,Math.ceil(total/pageSize)) }
}
