import NextAuth from "next-auth"
import authConfig from "./auth.config"

// Decode the same signed session cookie without importing credential/database
// providers into the globally replicated routing proxy. APIs/pages retain their
// fresh tenant, status, module and permission checks through auth.ts.
export const { auth } = NextAuth(authConfig)
