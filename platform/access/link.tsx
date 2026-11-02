"use client"
import Link from "next/link"
import type { ComponentProps } from "react"
import { useBusinessModules } from "../module-provider"
import { useRouteAccess } from "./route-provider"
import { useListReturnHref } from "@/components/erp/list-navigation"
export default function AccessLink({ restoreList = false, ...props }: ComponentProps<typeof Link> & { restoreList?: boolean }) {
 const restored = useListReturnHref(restoreList && typeof props.href === "string" ? props.href : undefined)
 const { can } = useBusinessModules()
 const { linkRequirement } = useRouteAccess()
 const path = (typeof props.href === "string" ? props.href : props.href.pathname || "").split("?")[0]
 const requirement = linkRequirement(path)
 if (requirement && !can(requirement)) return path.endsWith("/new") ? null : <span>{props.children}</span>
 return <Link {...props} href={restored || props.href} />
}
