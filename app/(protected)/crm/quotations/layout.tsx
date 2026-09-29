import { ModuleAccess } from "@/platform/module-access"
export default function Layout({ children }: { children: React.ReactNode }) { return <ModuleAccess module="salesDocuments">{children}</ModuleAccess> }
