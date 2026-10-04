import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { requireLookup } from "@/platform/core/lookups"
import { taxLookupQuerySchema } from "@/lib/validation"
export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    await requireLookup(actor, [["services", "services.read"], ["inventory", "inventoryProducts.read"], ["appointments", "appointments.read"]], "taxRates.read")
    const { page, pageSize, q } = taxLookupQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const where = { tenantId: actor.tenantId, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) }
    const [items, total] = await prisma.$transaction([
      prisma.tax.findMany({ where, select: { id: true, name: true, percent: true, isActive: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }), prisma.tax.count({ where }),
    ])
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  })
}
