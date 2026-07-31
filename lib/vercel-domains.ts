const VERCEL_API_BASE_URL = "https://api.vercel.com"

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

type VercelProjectDomainResponse = {
  name?: string
  apexName?: string
  verified?: boolean
  verification?: JsonValue[]
}

type VercelErrorResponse = {
  error?: {
    code?: string
    message?: string
  }
}

export type EnsureVercelProjectDomainResult = {
  skipped: boolean
  configured: boolean
  alreadyConfigured: boolean
  verified: boolean | null
  verification: JsonValue[]
}

const getVercelProjectIdOrName = () =>
  process.env.VERCEL_PROJECT_ID?.trim() || process.env.VERCEL_PROJECT_NAME?.trim() || ""

const getVercelTeamId = () => process.env.VERCEL_TEAM_ID?.trim() || ""

const buildVercelProjectDomainUrl = () => {
  const projectIdOrName = getVercelProjectIdOrName()
  if (!projectIdOrName) return null

  const url = new URL(
    `/v10/projects/${encodeURIComponent(projectIdOrName)}/domains`,
    VERCEL_API_BASE_URL
  )
  const teamId = getVercelTeamId()
  if (teamId) url.searchParams.set("teamId", teamId)
  return url
}

const parseVercelError = async (response: Response) => {
  const body = await response.json().catch(() => null) as VercelErrorResponse | null
  return body?.error
}

export async function ensureVercelProjectDomain(domain: string): Promise<EnsureVercelProjectDomainResult> {
  const token = process.env.VERCEL_API_TOKEN?.trim()
  const url = buildVercelProjectDomainUrl()

  if (!token || !url) {
    return {
      skipped: true,
      configured: false,
      alreadyConfigured: false,
      verified: null,
      verification: [],
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
  })

  if (response.ok) {
    const body = await response.json().catch(() => ({})) as VercelProjectDomainResponse
    return {
      skipped: false,
      configured: true,
      alreadyConfigured: false,
      verified: body.verified ?? null,
      verification: body.verification ?? [],
    }
  }

  const error = await parseVercelError(response)
  const message = error?.message ?? "Unable to add custom domain to Vercel project."
  const lowerMessage = message.toLowerCase()
  const alreadyConfigured =
    response.status === 400 &&
    (error?.code === "domain_already_in_use" || lowerMessage.includes("already exists"))

  if (alreadyConfigured) {
    return {
      skipped: false,
      configured: true,
      alreadyConfigured: true,
      verified: null,
      verification: [],
    }
  }

  throw new Error(message)
}
