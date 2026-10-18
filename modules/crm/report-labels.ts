import type { TermResolver } from "@/platform/terminology/resolver"
import type { SalesReportLabel, SalesReportGrouping, SalesReportView } from "@/types/crm-sales-report"

export const salesReportLabels = (term: TermResolver): Record<SalesReportView, string> => ({
  leads: term("crm.enquiry.plural", "Leads created", "{label} created"),
  converted: term("crm.enquiry.plural", "Converted leads", "Converted {label}"),
  pipeline: term("crm.opportunity.plural", "Open opportunities", "Open {label}"),
  won: term("crm.opportunity.plural", "Won opportunities", "Won {label}"),
  lost: term("crm.opportunity.plural", "Lost opportunities", "Lost {label}"),
  overdue: "Overdue follow-ups",
  gaps: term("crm.opportunity.plural", "Deals without open work", "{label} without open work"),
})

// The owning extension supplies display metadata; keys and stored names stay intact.
export const reportLabel = (term: TermResolver, item: SalesReportLabel, grouped = false) => {
  const fallback = grouped ? `By ${item.label.toLowerCase()}` : item.label
  return item.terminologyKey ? term(item.terminologyKey, fallback, grouped ? "By {label}" : "{label}") : fallback
}
export const reportBucketLabel = (term: TermResolver, dimension: SalesReportGrouping | undefined, id: string, label: string) =>
  id === "__none__" && dimension?.terminologyKey ? term(dimension.terminologyKey, dimension.emptyLabel, "No {label}") : label
