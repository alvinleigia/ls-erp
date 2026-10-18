import { termText } from "@/platform/terminology/message"
import type { FieldResource } from "@/platform/custom-fields/resources"
import { BusinessError } from "@/platform/policy"
export const projectFields: FieldResource = {
  scopeLabels: { PROJECT: termText("realEstate.project.plural", "Projects") },
  key: "project", permissionResource: "projects", label: "Projects", module: "realEstate", table: "RealEstateProjectFieldValue", scopes: ["PROJECT"],
  context: { teamScoped: false, async validate(_tx, _actor, salesTeamId) {
    if (salesTeamId) throw new BusinessError(400, termText("realEstate.project.singular", "Project fields apply to the whole business, not a sales team.", "{label} fields apply to the whole business, not a sales team."))
  } },
}
