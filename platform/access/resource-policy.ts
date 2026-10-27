import { resourceKeys, type Resource } from "./catalog"
import { resourceRegistry } from "./resource-registry"

export const recordPolicyDescriptions = {
  sales: "Sales scope: own assignments, managed teams or all records; related records inherit source access.",
  projects: "Project scope: explicit assignments and project teams; subprojects inherit their parent. General catalog items remain shared.",
  personal: "Own requests only.",
  reportingManager: "Assigned reporting manager only; team management does not grant approval authority.",
  workforce: "Module/action permissions. Operational schedules also retain office and workplace rules.",
  operations: "Saved-office operations, bounded by module/action permissions and current office access.",
  shared: "Tenant-shared reference data, subject to module and action permissions.",
  administrative: "Business read permissions; security administration remains tenant-admin only.",
  sources: "Each source module's record policy; filters can only narrow access.",
  teams: "Membership and designated team authority, bounded separately for each action.",
  directory: "Assignment targets within the user's allowed people scope.",
  reporting: "Own work or all accessible source records; source policies still apply.",
} as const
export type ResourceRecordPolicy = keyof typeof recordPolicyDescriptions
// Scope families come from the same exhaustive contract as ownership metadata.
export const resourceRecordPolicies = Object.fromEntries(resourceKeys.map(resource => [resource, resourceRegistry[resource].policy])) as {
  readonly [R in Resource]: typeof resourceRegistry[R]["policy"]
}
