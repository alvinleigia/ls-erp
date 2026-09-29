"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { isCrmConfigurationPath } from "../configuration"

const crmLinks = [
  ["Overview", "/crm/overview"], ["Sales reports", "/crm/sales"], ["Opportunities", "/crm/opportunities"],
  ["Enquiries", "/crm/enquiries"], ["Contacts", "/crm/contacts"],
  ["Business accounts", "/crm/accounts"], ["My Work", "/crm/activities"],
  ["Calendar", "/crm/calendar"], ["Configuration", "/crm/configuration"],
] as const

export function CrmNavigation({ extensionLinks = [] }: { extensionLinks?: readonly (readonly [string, string])[] }) {
  const links = [...crmLinks, ...extensionLinks]
  const pathname = usePathname()
  const active = links.find(([, href]) => href === "/crm/configuration" ? isCrmConfigurationPath(pathname) : pathname === href || pathname.startsWith(`${href}/`))
  return <nav aria-label="CRM" className="min-w-0 border-b pb-3">
    <div className="hidden items-center gap-1 overflow-x-auto lg:flex">{links.map(([label, href]) => <Link key={href} href={href} aria-current={active?.[1] === href ? "page" : undefined} className={cn("shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground", active?.[1] === href && "bg-secondary text-foreground")}>{label}</Link>)}</div>
    <div className="lg:hidden"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="w-full justify-between">{active?.[0] || "CRM views"}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">{links.map(([label, href]) => <DropdownMenuItem key={href} asChild><Link href={href} aria-current={active?.[1] === href ? "page" : undefined}>{label}</Link></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
  </nav>
}
