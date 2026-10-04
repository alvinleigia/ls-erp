"use client"

import type { ComponentProps } from "react"
import { CrmPagination } from "./crm-pagination"
export { Timeline as CrmTimeline, type TimelineEntry as CrmTimelineEntry } from "@/components/erp/timeline"

export function TimelinePagination(props: ComponentProps<typeof CrmPagination>) { return <CrmPagination {...props} /> }
