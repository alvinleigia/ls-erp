export const crmConfigurationGroups = [
  { title: "Sales process", description: "Define sales stages and classify incoming enquiries and lost business.", items: [
    { title: "Quotation templates", href: "/crm/configuration/quotation-templates", description: "Configure reusable pricing, charges, instalments and document terms." },
    { title: "Sales teams", href: "/crm/configuration/sales-teams", description: "Manage membership, assignment and qualification workflow." },
    { title: "Configuration presets", href: "/crm/configuration/presets", description: "Preview and add reusable sales configuration without replacing your choices." },
    { title: "Custom fields", href: "/crm/configuration/custom-fields", description: "Add typed fields to enquiries, opportunities and supported industry records." },
    { title: "Pipelines", href: "/crm/pipelines", description: "Configure stages, probabilities and won/lost outcomes." },
    { title: "Lead sources", href: "/crm/lead-sources", description: "Track where enquiries come from." },
    { title: "Lost reasons", href: "/crm/lost-reasons", description: "Use consistent reasons for lost enquiries and opportunities." },
  ] },
  { title: "Activities and follow-ups", description: "Standardize the work your sales team schedules and completes.", items: [
    { title: "Activity types", href: "/crm/activity-types", description: "Define calls, meetings, site visits and other activity choices." },
    { title: "Activity plans", href: "/crm/activity-plans", description: "Create reusable sequences of sales activities." },
    { title: "Follow-up rules", href: "/crm/follow-up-rules", description: "Suggest the next activity based on a recorded outcome." },
  ] },
] as const

export function isCrmConfigurationPath(path: string) {
  return path === "/crm/configuration" || path.startsWith("/crm/configuration/") || crmConfigurationGroups.some(group => group.items.some(item => path === item.href || path.startsWith(`${item.href}/`)))
}
