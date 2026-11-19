import type { Prisma } from "@prisma/client"

// The database owns lineage. Callers must intersect this with their native
// record scope; a hierarchy relation never grants access to another record.
export const projectBranch = (id: string): Prisma.RealEstateProjectWhereInput => ({
  lineage: { some: { ancestorId: id } },
})
export const activeProjectBranch: Prisma.RealEstateProjectWhereInput = {
  lineage: { none: { ancestor: { archived: true } } },
}

export async function projectBreadcrumbs(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const links = await tx.realEstateProjectAncestor.findMany({
    where: { tenantId, descendantId: id }, orderBy: { distance: "desc" }, select: { ancestorId: true },
  })
  const rows = await tx.realEstateProject.findMany({ where: { tenantId, id: { in: links.map(link => link.ancestorId) } }, select: { id: true, name: true, code: true, archived: true } })
  const byId = new Map(rows.map(row => [row.id, row]))
  return links.flatMap(link => { const row = byId.get(link.ancestorId); return row ? [row] : [] })
}

export async function withProjectPaths<T extends { id: string; name: string }>(tx: Prisma.TransactionClient, tenantId: string, rows: T[]) {
  if (!rows.length) return [] as (T & { pathName: string })[]
  const links = await tx.realEstateProjectAncestor.findMany({
    where: { tenantId, descendantId: { in: rows.map(row => row.id) } },
    orderBy: { distance: "desc" }, select: { descendantId: true, ancestorId: true },
  })
  // Match lineage as IDs first. Fetch names through the ordinary project RLS,
  // including when a source-only CRM reader cannot browse the directory.
  const names = await tx.realEstateProject.findMany({ where: { tenantId, id: { in: [...new Set(links.map(link => link.ancestorId))] } }, select: { id: true, name: true } })
  const byId = new Map(names.map(row => [row.id, row.name])), paths = new Map<string, string[]>()
  for (const link of links) {
    const name = byId.get(link.ancestorId)
    if (!name) continue
    const path = paths.get(link.descendantId) || []
    path.push(name); paths.set(link.descendantId, path)
  }
  return rows.map(row => ({ ...row, pathName: paths.get(row.id)?.join(" / ") || row.name }))
}
