import { withBusinessApi } from "@/platform/business-api"
import { inventoryOfficeChoices } from "@/modules/inventory/office-choices"
export const GET=(request:Request)=>withBusinessApi(request,actor=>inventoryOfficeChoices(actor,Object.fromEntries(new URL(request.url).searchParams)))
