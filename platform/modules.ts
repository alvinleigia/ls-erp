// Only independently enforceable modules belong here. Legacy salon modules
// remain available until their server boundaries have been extracted and tested.
type ModuleDefinition = { name: string; description: string; defaultEnabled: boolean; href: string; requires: readonly string[]; parent?: string }
export const businessModules = {
  crm: {
    name: "CRM",
    description: "Contacts, enquiries and follow-up tasks",
    defaultEnabled: false,
    href: "/crm/enquiries",
    requires: [],
  },
  realEstate: {
    name: "Real Estate", description: "Projects and subprojects for property sales. Requires CRM.",
    defaultEnabled: false, href: "/crm/projects",
    requires: ["crm"],
  },
  salesDocuments: {
    name: "Sales Documents", description: "Quotations, reusable templates and saved PDF versions.",
    defaultEnabled: false, href: "/crm/quotations", requires: ["crm"],
  },
  paymentPlans: {
    name: "Payment Plans", description: "Optional instalment schedules within Sales Documents. Does not collect payments.",
    defaultEnabled: false, href: "/crm/quotations", requires: ["salesDocuments"], parent: "salesDocuments",
  },
} as const satisfies Record<string, ModuleDefinition>

export type BusinessModuleKey = keyof typeof businessModules
export type ModuleFlag = { key: string; enabled: boolean }
export const moduleKeys = Object.keys(businessModules) as [BusinessModuleKey, ...BusinessModuleKey[]]

export function moduleEnabled(flags: readonly ModuleFlag[], key: BusinessModuleKey): boolean {
  return (flags.find(row => row.key === key)?.enabled ?? businessModules[key].defaultEnabled) &&
    businessModules[key].requires.every(required => moduleEnabled(flags, required as BusinessModuleKey))
}

export function moduleChangeProblem(flags: readonly ModuleFlag[], key: BusinessModuleKey, enabled: boolean): string | null {
  if (enabled) {
    const missing = businessModules[key].requires.filter(required => !moduleEnabled(flags, required as BusinessModuleKey))
    if (missing.length) return `Enable ${missing.map(required => businessModules[required as BusinessModuleKey].name).join(", ")} before enabling ${businessModules[key].name}.`
  } else {
    const dependents = moduleKeys.filter(other => (businessModules[other].requires as readonly string[]).includes(key) && flags.some(row => row.key === other && row.enabled))
    if (dependents.length) return `Disable ${dependents.map(other => businessModules[other].name).join(", ")} before disabling ${businessModules[key].name}.`
  }
  return null
}
