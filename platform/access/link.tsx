"use client"
import Link from "next/link"
import type { ComponentProps } from "react"
import { useBusinessModules } from "../module-provider"
import { routeRequirement } from "./routes"
export default function AccessLink(props: ComponentProps<typeof Link>) {
 const { can } = useBusinessModules()
 const path = (typeof props.href === "string" ? props.href : props.href.pathname || "").split("?")[0]
 const requirement = path.startsWith("/crm/") ? routeRequirement(path) : undefined
 if (requirement && !can(requirement)) return path.endsWith("/new") ? null : <span>{props.children}</span>
 return <Link {...props} />
}
