import { defaultTermResolver, type TermResolver } from "@/platform/terminology/resolver"

export const getCrmConfigurationGroups = (term: TermResolver = defaultTermResolver) => [
  { title: "Sales process", description: term("crm.enquiry.plural", "Define sales stages and classify incoming enquiries and lost business.", "Define sales stages and classify incoming {label} and lost business."), items: [
    { title: "Sales teams", href: "/crm/configuration/sales-teams", description: "Manage membership, assignment and qualification workflow." },
    { title: "Configuration presets", href: "/crm/configuration/presets", description: "Preview and add reusable sales configuration without replacing your choices." },
    { title: "Custom fields", href: "/crm/configuration/custom-fields", description: `Add typed fields to ${term("crm.enquiry.plural", "enquiries")}, ${term("crm.opportunity.plural", "opportunities")} and supported industry records.` },
    { title: "Pipelines", href: "/crm/pipelines", description: "Configure stages, probabilities and won/lost outcomes." },
    { title: term("crm.enquiry.singular", "Lead sources", "{label} sources"), href: "/crm/lead-sources", description: term("crm.enquiry.plural", "Track where enquiries come from.", "Track where {label} come from.") },
    { title: "Lost reasons", href: "/crm/lost-reasons", description: `Use consistent reasons for lost ${term("crm.enquiry.plural", "enquiries")} and ${term("crm.opportunity.plural", "opportunities")}.` },
  ] },
  { title: term("crm.activity.plural", "Activities and follow-ups", "{label} and follow-ups"), description: "Standardize the work your sales team schedules and completes.", items: [
    { title: term("crm.activity.singular", "Activity types", "{label} types"), href: "/crm/activity-types", description: term("crm.activity.singular", "Define calls, meetings, site visits and other activity choices.", "Define calls, meetings, site visits and other {label} choices.") },
    { title: term("crm.activity.singular", "Activity plans", "{label} plans"), href: "/crm/activity-plans", description: term("crm.activity.plural", "Create reusable sequences of sales activities.", "Create reusable sequences of sales {label}.") },
    { title: "Follow-up rules", href: "/crm/follow-up-rules", description: term("crm.activity.singular", "Suggest the next activity based on a recorded outcome.", "Suggest the next {label} based on a recorded outcome.") },
  ] },
] as const

export const crmConfigurationGroups = getCrmConfigurationGroups()

export function isCrmConfigurationPath(path: string) {
  return path === "/crm/configuration" || path.startsWith("/crm/configuration/") || crmConfigurationGroups.some(group => group.items.some(item => path === item.href || path.startsWith(`${item.href}/`)))
}
