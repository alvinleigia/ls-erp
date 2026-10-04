import { prisma } from "@/lib/prisma"
import { directoryQuerySchema } from "@/lib/validation"
import { withBusinessApi } from "@/platform/business-api"
import { requireLookup } from "@/platform/core/lookups"

export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    const { role, q, page, pageSize } = directoryQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    await requireLookup(actor, role === "CUSTOMER" ? [["appointments", "appointments.read"]] : role === "MANAGER" ? [] : [
      ["appointments", "appointments.read"], ["leaves", "leaveGroups.read"],
      ["shifts", "shiftSchedules.read"], ["shifts", "shiftPlans.read"], ["shifts", "shiftRoster.read"],
    ], "users.read")
    const where = { tenantId: actor.tenantId, role, status: "ACTIVE" as const,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}) }
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({ where, select: { id: true, name: true, email: true, role: true, phone: role === "CUSTOMER", staffProfile: { select: { schedulingMode: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.user.count({ where }),
    ])
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  })
}
