"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const crmLinks = [
  ["Overview", "/crm/overview"], ["Sales reports", "/crm/sales"], ["Opportunities", "/crm/opportunities"],
  ["Enquiries", "/crm/enquiries"], ["Contacts", "/crm/contacts"],
  ["Business accounts", "/crm/accounts"], ["My Work", "/crm/activities"],
  ["Calendar", "/crm/calendar"], ["Pipelines", "/crm/pipelines"],
  ["Activity plans", "/crm/activity-plans"], ["Follow-up rules", "/crm/follow-up-rules"],
  ["Lead sources", "/crm/lead-sources"], ["Lost reasons", "/crm/lost-reasons"],
] as const

export function CrmNavigation({ realEstateEnabled = false }: { realEstateEnabled?: boolean }) {
  const links = realEstateEnabled ? [...crmLinks, ["Projects", "/crm/projects"] as const] : crmLinks
  const pathname = usePathname()
  const active = links.find(([, href]) => pathname === href || pathname.startsWith(`${href}/`))
  return <nav aria-label="CRM" className="min-w-0 border-b pb-3">
    <div className="hidden items-center gap-1 overflow-x-auto lg:flex">{links.map(([label, href]) => <Link key={href} href={href} aria-current={active?.[1] === href ? "page" : undefined} className={cn("shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground", active?.[1] === href && "bg-secondary text-foreground")}>{label}</Link>)}</div>
    <div className="lg:hidden"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="w-full justify-between">{active?.[0] || "CRM views"}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">{links.map(([label, href]) => <DropdownMenuItem key={href} asChild><Link href={href} aria-current={active?.[1] === href ? "page" : undefined}>{label}</Link></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
  </nav>
}
