
export type ProjectDashboard = {
  projects: null | { active: number; subprojects: number; items: { id: string; name: string; enquiries: number | null; opportunities: number | null }[] }
}
