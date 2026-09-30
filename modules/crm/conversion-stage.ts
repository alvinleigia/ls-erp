import type { CrmStageRow } from "@/types/crm"

// Pipeline responses are already ordered by position. Direct opportunities keep
// the normal first-open-stage behavior; conversion can use a configured default.
export function initialOpportunityStage(stages: CrmStageRow[], converting: boolean) {
  const open = stages.filter(stage => !stage.archived && stage.kind === "OPEN")
  return (converting ? open.find(stage => stage.isConversionDefault) : undefined) || open[0]
}
