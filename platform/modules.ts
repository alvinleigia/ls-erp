// Only independently enforceable modules belong here. Legacy salon modules
// remain available until their server boundaries have been extracted and tested.
export const businessModules = {
  crm: {
    name: "CRM",
    description: "Contacts, enquiries and follow-up tasks",
    defaultEnabled: false,
    href: "/crm/enquiries",
  },
  realEstate: {
    name: "Real Estate", description: "Projects and subprojects for property sales. Requires CRM.",
    defaultEnabled: false, href: "/crm/projects",
  },
} as const

export type BusinessModuleKey = keyof typeof businessModules
