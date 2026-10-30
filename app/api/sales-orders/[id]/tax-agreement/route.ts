import { prisma } from '@/lib/prisma'
import { withBusinessApi } from '@/platform/business-api'
import { readOrderTaxAcceptance } from '@/modules/sales-orders/tax-acceptance'
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withBusinessApi(r,async a=>readOrderTaxAcceptance(prisma,a,(await c.params).id))
