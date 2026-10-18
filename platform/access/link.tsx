"use client"
import Link from "next/link"
import type { ComponentProps } from "react"
import { useBusinessModules } from "../module-provider"
import { useRouteAccess } from "./route-provider"
export default function AccessLink(props: ComponentProps<typeof Link>) {
 const { can } = useBusinessModules()
 const { linkRequirement } = useRouteAccess()
 const path = (typeof props.href === "string" ? props.href : props.href.pathname || "").split("?")[0]
 const requirement = linkRequirement(path)
 if (requirement && !can(requirement)) return path.endsWith("/new") ? null : <span>{props.children}</span>
 return <Link {...props} />
}
