import type { NextAuthConfig } from "next-auth"

// Shared JWT/session presentation only. Credential checks and database refresh
// stay in auth.ts; the routing proxy must not package the database client.
const authConfig = {
  providers: [],
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/signin" },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? session.user.id
        ;(session.user as { role?: string }).role = token.role as string | undefined
        ;(session.user as { tenantId?: string }).tenantId = token.tenantId as
          | string
          | undefined
        ;(session.user as { tenantSlug?: string }).tenantSlug = token.tenantSlug as
          | string
          | undefined
        ;(session.user as { platformAccessMode?: string | null }).platformAccessMode =
          (token.platformAccessMode as string | null | undefined) ?? null
        ;(session.user as { organizationIds?: string[] }).organizationIds =
          (token.organizationIds as string[] | undefined) ?? []
        ;(session.user as { organizationRolesById?: Record<string, string> }).organizationRolesById =
          (token.organizationRolesById as Record<string, string> | undefined) ?? {}
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`

      try {
        const target = new URL(url)
        const base = new URL(baseUrl)
        if (target.origin === base.origin) return url

        const targetHost = target.hostname.toLowerCase()
        const baseHost = base.hostname.toLowerCase()
        if (
          baseHost === "localhost" &&
          (targetHost === "localhost" || targetHost.endsWith(".localhost"))
        ) {
          return url
        }

        const rootDomain = process.env.APP_ROOT_DOMAIN?.trim().toLowerCase()
        if (rootDomain) {
          const sameRootDomain =
            (targetHost === rootDomain || targetHost.endsWith(`.${rootDomain}`)) &&
            (baseHost === rootDomain || baseHost.endsWith(`.${rootDomain}`))
          if (sameRootDomain) return url
        }
      } catch {
        return baseUrl
      }

      return baseUrl
    },
  },
} satisfies NextAuthConfig

export default authConfig
