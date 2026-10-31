import type { TermResolver } from "@/platform/terminology/resolver"

// Closed report metrics shared by the UI, query validation and CSV. Counts for
// converted enquiries and call outcomes overlap their parent totals.
export const teamMetrics = {
  enquiries: { label: "Enquiries created", group: "enquiries" },
  new: { label: "New", group: "enquiries" },
  contacted: { label: "Contacted", group: "enquiries" },
  qualified: { label: "Qualified", group: "enquiries" },
  closed: { label: "Lost enquiries", group: "enquiries" },
  converted: { label: "Converted", group: "enquiries" },
  pipeline: { label: "Open opportunities", group: "opportunities" },
  won: { label: "Won in period", group: "opportunities" },
  lost: { label: "Lost in period", group: "opportunities" },
  gaps: { label: "Without open follow-up", group: "opportunities" },
  activitiesOpen: { label: "Open activities", group: "activities" },
  activitiesInProgress: { label: "In progress", group: "activities" },
  activitiesOverdue: { label: "Overdue", group: "activities" },
  activitiesDueToday: { label: "Due today", group: "activities" },
  activitiesCompleted: { label: "Completed in period", group: "activities" },
  activitiesCancelled: { label: "Cancelled (created in period)", group: "activities" },
  callsCompleted: { label: "Calls completed", group: "calls" },
  connected: { label: "Connected", group: "calls" },
  noAnswer: { label: "No answer", group: "calls" },
  busy: { label: "Busy", group: "calls" },
  voicemail: { label: "Voicemail", group: "calls" },
  wrongNumber: { label: "Wrong number", group: "calls" },
  notInterested: { label: "Not interested", group: "calls" },
  unknownOutcome: { label: "Unrecorded outcome", group: "calls" },
} as const
export type TeamMetric = keyof typeof teamMetrics
export const teamMetricKeys = Object.keys(teamMetrics) as TeamMetric[]
export function teamMetricLabel(term: TermResolver, metric: TeamMetric) {
  const group = teamMetrics[metric].group
  const key = group === "enquiries" ? "crm.enquiry.plural" : group === "opportunities" ? "crm.opportunity.plural" : group === "activities" ? "crm.activity.plural" : null
  const templates: Partial<Record<TeamMetric, string>> = { enquiries: "{label} created", new: "New {label}", contacted: "Contacted {label}", qualified: "Qualified {label}", closed: "Lost {label}", converted: "Converted {label}", pipeline: "Open {label}", won: "Won {label} in period", lost: "Lost {label} in period", gaps: "{label} without open follow-up", activitiesOpen: "Open {label}", activitiesInProgress: "{label} in progress", activitiesOverdue: "Overdue {label}", activitiesDueToday: "{label} due today", activitiesCompleted: "{label} completed in period", activitiesCancelled: "Cancelled {label} (created in period)" }
  return key ? term(key, teamMetrics[metric].label, templates[metric]) : teamMetrics[metric].label
}
export type TeamPerformanceCounts = Record<TeamMetric, number>
export type TeamPerformanceRow = TeamPerformanceCounts & {
  id: string; name: string; status: string; userType: "internal" | "external";
  isMember: boolean; conversionPercent: number | null;
  pipelineValues: { currency: string; amount: string }[];
}
export type TeamPerformanceRecord = { id: string; title: string; kind: "enquiries" | "opportunities" | "activities"; assignedUserId: string; owner: string; status: string; currency: string | null; amount: string | null }
export type TeamPerformanceResponse = {
  items: TeamPerformanceRow[]; total: number; totalPages: number; page: number; pageSize: number;
  totals: TeamPerformanceCounts & { conversionPercent: number | null; pipelineValues: TeamPerformanceRow["pipelineValues"] };
  from: string; through: string; timeZone: string; generatedAt: string; canReadRoster: boolean;
  team: { id: string; name: string; archived: boolean } | null;
}
