import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import { moduleEnabled } from "../modules"
import { permits } from "../access/policy"

export const securityEvents: Prisma.AuditLogWhereInput = { OR: ["access.", "module.", "tenant.", "core.invitations.", "crm.team.manager."].map(prefix => ({ event: { startsWith: prefix } })) }

export async function auditScope(tx: Prisma.TransactionClient, actor: BusinessActor): Promise<Prisma.AuditLogWhereInput> {
 const tenantId = actor.tenantId
    const flags = await tx.tenantModule.findMany({ where: { tenantId }, select: { key: true, allowed: true, enabled: true } })
    const appointmentsEnabled = moduleEnabled(flags, "appointments")
    const canReadBookings = appointmentsEnabled && permits(actor, "appointments.read")
    const canReadCoupons = appointmentsEnabled && permits(actor, "appointmentCoupons.read")
    return {
      // Apply access before pagination/counting; the same predicate guards detail reads.
      AND: [
        ...(!moduleEnabled(flags, "crm") ? [{ NOT: { AND: [{ event: { startsWith: "crm." } }, { NOT: securityEvents }] } }] : []),
        ...(!moduleEnabled(flags, "salesDocuments") ? [{ NOT: { OR: [{ event: { startsWith: "crm.quotation." } }, { event: { startsWith: "crm.quotationTemplate." } }] } }] : []),
        ...(!moduleEnabled(flags, "realEstate") ? [{ NOT: { entityType: { startsWith: "RealEstate" } } }] : []),
        ...(["inventoryProducts", "inventoryCategories", "inventorySuppliers", "inventoryPurchases"] as const).filter(resource => !moduleEnabled(flags, "inventory") || !permits(actor, `${resource}.read`)).map(resource => ({ NOT: { event: { startsWith: `inventory.${resource}.` } } })),
        ...(["services", "serviceCategories"] as const).filter(resource => !moduleEnabled(flags, "services") || !permits(actor, `${resource}.read`)).map(resource => ({ NOT: { event: { startsWith: `services.${resource}.` } } })),
        ...(!(actor.role === "ADMIN" && moduleEnabled(flags, "services")) ? [{ NOT: { event: { startsWith: "services.eligibility." } } }] : []),
        ...(actor.role !== "ADMIN" ? [{ OR: [
          { id: { in: [] as string[] } }, // Explicit deny when no resource is readable.
          ...(permits(actor, "businessSettings.read") ? [{ event: { startsWith: "core.businessSettings." } }] : []),
          ...(permits(actor, "taxRates.read") ? [{ event: { startsWith: "core.taxRates." } }] : []),
          ...(["inventoryProducts", "inventoryCategories", "inventorySuppliers", "inventoryPurchases"] as const).filter(resource => moduleEnabled(flags, "inventory") && permits(actor, `${resource}.read`)).map(resource => ({ event: { startsWith: `inventory.${resource}.` } })),
          ...(["services", "serviceCategories"] as const).filter(resource => moduleEnabled(flags, "services") && permits(actor, `${resource}.read`)).map(resource => ({ event: { startsWith: `services.${resource}.` } })),
          ...(["leaveDefinitions", "leaveGroups", "shiftTemplates", "shiftSchedules", "shiftPlans", "shiftRoster"] as const).filter(resource => moduleEnabled(flags, resource.startsWith("leave") ? "leaves" : "shifts") && permits(actor, `${resource}.read`)).map(resource => ({ event: { startsWith: `workforce.${resource}.` } })),
          ...(canReadBookings ? ["appointment.", "appointments.order.", "appointments.invoice."].map(prefix => ({ event: { startsWith: prefix } })) : []),
          ...(canReadCoupons ? [{ event: { startsWith: "appointments.coupon." } }] : []),
        ] }] : []),
        ...(["leaveDefinitions", "leaveGroups", "shiftTemplates", "shiftSchedules", "shiftPlans", "shiftRoster"] as const).filter(resource => !moduleEnabled(flags, resource.startsWith("leave") ? "leaves" : "shifts") || !permits(actor, `${resource}.read`)).map(resource => ({ NOT: { event: { startsWith: `workforce.${resource}.` } } })),
        ...(!(actor.role === "ADMIN" && moduleEnabled(flags, "leaves") && permits(actor, "leaveApprovals.read")) ? [{ NOT: { event: { startsWith: "leave.request." } } }] : []),
        ...(!canReadBookings ? [{ NOT: { OR: [{ event: { startsWith: "appointment." } }, { event: { startsWith: "appointments.order." } }, { event: { startsWith: "appointments.invoice." } }] } }] : []),
        ...(!canReadCoupons ? [{ NOT: { event: { startsWith: "appointments.coupon." } } }] : []),
      ],
      tenantId,
    }
}
