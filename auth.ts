import NextAuth from "next-auth"
import authConfig from "./auth.config"
import bcrypt from "bcryptjs"
import Credentials from "next-auth/providers/credentials"

import { prisma, runWithRlsBypassDbContext, runWithTenantDbContext } from "@/lib/prisma"
import { resolvePlatformConsoleAccess } from "@/lib/platform-console"
import { resolveTenantFromHostHeader } from "@/lib/tenancy"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const creds = credentials as { email?: string; password?: string } | undefined
        const email = creds?.email?.trim().toLowerCase()
        const password = creds?.password?.trim()

        if (!email || !password) return null

        const host =
          request?.headers?.get("x-forwarded-host") ??
          request?.headers?.get("host")
        const tenant = await resolveTenantFromHostHeader(host)
        if (!tenant) return null

        return runWithTenantDbContext(tenant.id, async () => {
          const user = await prisma.user.findFirst({
            where: { email, tenantId: tenant.id },
          })
          if (!user || !user.passwordHash) return null
          if (!user.tenantId) return null
          if (user.status !== "ACTIVE") return null

          const isValid = await bcrypt.compare(password, user.passwordHash)
          if (!isValid) return null

          const platformAccess = await runWithRlsBypassDbContext(async () =>
            resolvePlatformConsoleAccess({
              tenantId: user.tenantId,
              role: user.role,
              sessionUserId: user.id,
            })
          )

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role,
            tenantId: user.tenantId,
            tenantSlug: tenant.slug,
            platformAccessMode: platformAccess?.mode ?? null,
            organizationIds: platformAccess?.organizationIds ?? [],
            organizationRolesById: platformAccess?.organizationRolesById ?? {},
          }
        })
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role
        token.tenantId = (user as { tenantId?: string }).tenantId
        token.tenantSlug = (user as { tenantSlug?: string }).tenantSlug
        token.platformAccessMode = (user as { platformAccessMode?: string | null }).platformAccessMode
        token.organizationIds = (user as { organizationIds?: string[] }).organizationIds ?? []
        token.organizationRolesById = (user as { organizationRolesById?: Record<string, string> }).organizationRolesById ?? {}
      } else if (token.tenantId && !token.tenantSlug) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: token.tenantId as string },
          select: { slug: true },
        })
        token.tenantSlug = tenant?.slug
      } else if (token.tenantId && token.platformAccessMode === undefined) {
        const platformAccess = await runWithRlsBypassDbContext(async () =>
          resolvePlatformConsoleAccess({
            tenantId: token.tenantId as string,
            role: token.role as string | null,
            sessionUserId: token.sub ?? null,
          })
        )
        token.platformAccessMode = platformAccess?.mode ?? null
        token.organizationIds = platformAccess?.organizationIds ?? []
        token.organizationRolesById = platformAccess?.organizationRolesById ?? {}
      }
      return token
    },
    async signIn({ user }) {
      const tenantId = (user as { tenantId?: string | null })?.tenantId ?? null
      if (user?.id && tenantId) {
        await runWithTenantDbContext(tenantId, async () => {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
        })
      }
      return true
    },
  },
})
