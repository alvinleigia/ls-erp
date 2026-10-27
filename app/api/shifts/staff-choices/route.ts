import { withBusinessApi } from "@/platform/business-api"
import { workforceStaffChoices } from "@/modules/workforce/staff-choices"
export const GET=(request:Request)=>withBusinessApi(request,actor=>workforceStaffChoices(actor,Object.fromEntries(new URL(request.url).searchParams)))
