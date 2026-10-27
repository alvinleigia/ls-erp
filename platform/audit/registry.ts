import type { Requirement, Resource } from "../access/catalog"
import type { BusinessModuleKey } from "../modules"

type AuditFamily = {
  prefix: string
  boundary: "security" | "shared" | "source" | "composed"
  read?: Requirement
  modules?: readonly BusinessModuleKey[]
  adminOnly?: boolean
  fullAudit?: boolean
  unscoped?: readonly Resource[]
}

// Closed report registry. A more specific prefix always overrides its parent,
// even when that family's module or permission is unavailable. Unknown events
// stay stored but cannot enter the composed report through a broad fallback.
export const auditFamilies: readonly AuditFamily[] = [
  ...["workspace.", "structure.", "access.", "module.", "tenant.", "organization.", "core.invitations.", "crm.team.", "team."].map(prefix => ({ prefix, boundary: "security" as const, adminOnly: true })),
  { prefix: "core.businessSettings.", boundary: "shared", read: "businessSettings.read" },
  { prefix: "core.taxRates.", boundary: "shared", read: "taxRates.read" },
  { prefix: "branding.", boundary: "shared", read: "branding.read" },
  { prefix: "terminology.", boundary: "shared", read: "businessSettings.read" },
  ...(["inventoryProducts", "inventoryCategories", "inventorySuppliers", "inventoryPurchases"] as const).map(resource => ({ prefix: `inventory.${resource}.`, boundary: resource === "inventoryPurchases" ? "source" as const : "shared" as const, read: `${resource}.read` as const, modules: ["inventory"] as const })),
  { prefix: "inventory.stock.", boundary: "source", read: "inventoryProducts.read", modules: ["inventory"] },
  ...(["services", "serviceCategories"] as const).map(resource => ({ prefix: `services.${resource}.`, boundary: "shared" as const, read: `${resource}.read` as const, modules: ["services"] as const })),
  { prefix: "services.eligibility.", boundary: "composed", modules: ["services"], adminOnly: true, fullAudit: true },
  ...(["leaveDefinitions", "leaveGroups", "shiftTemplates", "shiftSchedules", "shiftPlans", "shiftRoster"] as const).map(resource => ({ prefix: `workforce.${resource}.`, boundary: ["shiftSchedules", "shiftPlans", "shiftRoster"].includes(resource) ? "source" as const : "shared" as const, read: `${resource}.read` as const, modules: [resource.startsWith("leave") ? "leaves" : "shifts"] as readonly BusinessModuleKey[] })),
  { prefix: "leave.request.", boundary: "source", modules: ["leaves"], read: "leaveApprovals.read", fullAudit: true, adminOnly: true },
  ...["appointment.", "appointments.order.", "appointments.invoice."].map(prefix => ({ prefix, boundary: "source" as const, modules: ["appointments"] as const, read: "appointments.read" as const })),
  { prefix: "appointments.coupon.", boundary: "shared", modules: ["appointments"], read: "appointmentCoupons.read" },
  // These composed sales snapshots remain administrator-only. Non-admin users
  // use scoped record timelines; this report must not broaden that audience.
  { prefix: "crm.", boundary: "composed", modules: ["crm"], adminOnly: true },
  { prefix: "crm.quotation.", boundary: "source", modules: ["salesDocuments"], read: "quotations.read", adminOnly: true },
  { prefix: "crm.quotationTemplate.", boundary: "shared", modules: ["salesDocuments"], read: "quotationTemplates.read", adminOnly: true },
  { prefix: "crm.customField", boundary: "composed", modules: ["crm"], read: ["customFields.read", "restrictedFields.read"], adminOnly: true },
  { prefix: "realEstate.", boundary: "composed", modules: ["realEstate"], read: "projects.read", adminOnly: true },
  { prefix: "catalog.", boundary: "composed", modules: ["catalog"], read: "catalogItems.read", unscoped: ["projects"] },
  { prefix: "catalog.reservation.", boundary: "source", modules: ["catalog", "salesOrders"], read: ["catalogItems.read", "unitReservations.read", "salesOrders.read"], fullAudit: true, unscoped: ["enquiries", "opportunities", "contacts", "accounts", "activities", "quotations", "salesOrders", "receivables", "orderPayments", "projects"] },
  { prefix: "salesOrder.", boundary: "source", modules: ["salesOrders"], read: "salesOrders.read", adminOnly: true },
  { prefix: "receivable.", boundary: "source", modules: ["receivables"], read: ["salesOrders.read", "receivables.read", "orderPayments.read"], fullAudit: true, adminOnly: true },
]
