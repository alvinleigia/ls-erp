import { ZodError } from "zod"
import type { PrismaClient } from "@prisma/client"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "../policy"
import type { Term } from "./catalog"
import { readTermReplacements } from "./read"
import { createTermResolver, type TermResolver } from "./resolver"
import { resolveTermText, type TermText } from "./message"

type PresentedError = { error: string; details?: { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> } }
export type ErrorPresenter = (error: unknown, actor: BusinessActor) => Promise<PresentedError | undefined>
function issueText(issue: ZodError["issues"][number]): TermText | undefined {
  return issue.code === "custom" ? issue.params?.terminology as TermText | undefined : undefined
}
export function hasErrorPresentation(error: unknown) {
  return error instanceof BusinessError ? !!error.presentation : error instanceof ZodError && error.issues.some(issue => !!issueText(issue))
}
export function presentTermError(error: unknown, term: TermResolver): PresentedError | undefined {
  if (error instanceof BusinessError && error.presentation) return { error: resolveTermText(error.presentation, term) }
  if (error instanceof ZodError && hasErrorPresentation(error)) return {
    error: "Please check the highlighted fields.",
    details: error.flatten(issue => issueText(issue) ? resolveTermText(issueText(issue)!, term) : issue.message),
  }
}

// Called only for annotated errors, after the failing transaction has rolled back.
// Recheck membership and load one scoped snapshot; never mask the original error.
export function createTermErrorPresenter(db: PrismaClient, catalog: readonly Term[]): ErrorPresenter {
  return async (error, actor) => {
    if (!hasErrorPresentation(error)) return
    try {
      return await db.$transaction(async tx => {
        const user = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: actor.userId, status: "ACTIVE" }, select: { role: true, tenant: { select: { status: true, slug: true } } } })
        if (!user || !hasBusinessAccess(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) return
        const term = createTermResolver(await readTermReplacements(tx, actor.tenantId, catalog))
        return presentTermError(error, term)
      }, { isolationLevel: "RepeatableRead" })
    } catch { return undefined }
  }
}
