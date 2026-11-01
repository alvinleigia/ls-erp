import { ModuleControls, ModuleActivationHelp } from "@/platform/module-controls"

export default function ModulesPage() {
  return <div className="mx-auto max-w-3xl space-y-6">
    <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">Business modules</h1><ModuleActivationHelp /></div>
    <ModuleControls/>
  </div>
}
