import { accessResources, type Resource } from "./catalog"
import { resourceRegistry } from "./resource-registry"

type DirectSharingResource = "contacts" | "accounts" | "enquiries" | "opportunities" | "activities" | "projects" | "quotations" | "salesOrders"
function record<R extends DirectSharingResource>(resource: R) {
  const table = resourceRegistry[resource].record
  return { table, model: (table[0].toLowerCase() + table.slice(1)) as Uncapitalize<typeof table>, module: accessResources[resource].module }
}
// Register actual business records, not configuration or access-profile records.
export const sharingRecords = {
  contacts: { ...record("contacts"), label: "Contact", title: "name", owner: "ownerUserId" },
  accounts: { ...record("accounts"), label: "Business account", title: "name", owner: "ownerUserId" },
  enquiries: { ...record("enquiries"), label: "Enquiry", title: "title", owner: "assignedUserId" },
  opportunities: { ...record("opportunities"), label: "Opportunity", title: "title", owner: "assignedUserId" },
  activities: { ...record("activities"), label: "Activity", title: "title", owner: "assignedUserId" },
  projects: { ...record("projects"), label: "Project", title: "name", owner: null },
  quotations: { ...record("quotations"), label: "Quotation", title: "id", owner: null },
  salesOrders: { ...record("salesOrders"), label: "Sales order", title: "title", owner: null },
} as const
export type SharingResource = keyof typeof sharingRecords
export function sharingResource(resource: string): SharingResource | undefined {
  if (!Object.hasOwn(resourceRegistry, resource)) return undefined
  const contract = resourceRegistry[resource as Resource]
  const owner = "sharing" in contract ? contract.sharing : undefined
  return owner && Object.hasOwn(sharingRecords, owner) ? owner as SharingResource : undefined
}
