import { withBusinessApi } from "@/platform/business-api"
import { staffChoicesSchema, workforceStaffChoices } from "@/modules/workforce/staff-choices"

export function GET(request: Request) {
  return withBusinessApi(request, actor => workforceStaffChoices(actor, staffChoicesSchema.parse(Object.fromEntries(new URL(request.url).searchParams))))
}
