import type { PropertyContext } from "@/types/real-estate"

export function PropertyCaption({ context }: { context?: PropertyContext | null }) {
  if (!context?.project) return null
  return <p className="mt-1 text-xs text-muted-foreground">{context.project.name}{context.subproject ? ` / ${context.subproject.name}` : ""}{context.project.archived || context.subproject?.archived ? " (archived)" : ""}</p>
}
