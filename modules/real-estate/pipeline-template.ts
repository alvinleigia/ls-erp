import type { PipelineInput } from "@/modules/crm/sales-validation"
// Applied only as a new editable draft, never over an existing pipeline.
export const propertySalesPipeline: PipelineInput = { name: "Property sales", archived: false, stages: [
  { name: "Qualified interest", kind: "OPEN", probability: 10, color: "#64748b", archived: false },
  { name: "Site visit planned", kind: "OPEN", probability: 25, color: "#0ea5e9", archived: false },
  { name: "Site visit completed", kind: "OPEN", probability: 40, color: "#3b82f6", archived: false },
  { name: "Proposal", kind: "OPEN", probability: 60, color: "#8b5cf6", archived: false },
  { name: "Negotiation", kind: "OPEN", probability: 80, color: "#a855f7", archived: false },
  { name: "Won", kind: "WON", probability: 100, color: "#16a34a", archived: false },
  { name: "Lost", kind: "LOST", probability: 0, color: "#dc2626", archived: false },
] }
