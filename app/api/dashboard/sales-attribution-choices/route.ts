import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCoreApi } from "@/platform/core/api"
import { createDashboardSalesService } from "@/application/dashboard/sales-service"
export const GET=(request:Request)=>withCoreApi(request,"dashboard","read",async actor=>NextResponse.json(await createDashboardSalesService(prisma,actor).choices(Object.fromEntries(new URL(request.url).searchParams))))
