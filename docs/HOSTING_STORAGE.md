# Hosting storage controls

## Runtime contract

`auth.config.ts` contains database-free session presentation and redirect callbacks.
`auth-proxy.ts` decodes the same signed JWT cookie for routing. Credential checks,
database-backed JWT refresh, account status and business authorization stay in
`auth.ts` and the server guards. The proxy is not a business authorization boundary.
Do not import database providers into it.

The application uses Prisma's JavaScript engine and PostgreSQL compiler. Next's
output tracing excludes unused Rust engines and other database compilers. Retain
the generated PostgreSQL WASM/runtime, adapter dependencies and quotation font.
Do not exclude the entire Prisma runtime directory.

After building, run `npm.cmd run test:hosting`. This uses an isolated local Docker
database and Chrome. It checks actual PostgreSQL queries from an isolated copy of
the traced Prisma files, font inclusion, proxy dependencies, signed claims,
redirect policy, real logins, invalid cookies, fresh suspension enforcement,
platform separation and tenant isolation. Never substitute a hosted database.

## Vercel controls

Both projects use the same GitHub repository. The ignored build step permits only
`main` in `ls-erp` and `staging` in `ls-erp-staging`. Exit 0 skips a Git build; exit
1 builds it. Manual deployments with no Git reference remain allowed. The live
settings were set and read back on 2026-10-25.

```javascript
// ls-erp; replace 'main' with 'staging' in ls-erp-staging.
node -e "process.exit(!process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_GIT_COMMIT_REF === 'main' ? 1 : 0)"
```

Recommended dashboard retention: canceled/errored 1 day, previews 1 week,
production 30 days in `ls-erp` and 1 week in `ls-erp-staging`. These require saving
under Settings > Security > Deployment Retention Policy. At the last API check
on 2026-10-25 the settings still read 30 days in every category; the recommendation
must not be treated as applied. Vercel also preserves protected deployments under
its retention rules.

Before deleting a deployment, inspect authoritative current aliases and project
targets, preserve active destinations and tested production rollback candidates,
and recheck immediately before deletion. Deployment metadata can contain old or
intended aliases and is not the authoritative alias inventory.

## Verified cleanup and measurements, 2026-10-25

37 obsolete deployments were deleted. Eight protected deployments remained at
cleanup completion; all live targets and aliases were unchanged. Subsequent
optimized deployments add new entries. Sanitized receipts are locally ignored in
`tmp/hosting-usage`.

| Measurement | Before | After |
| --- | ---: | ---: |
| Local API dependency trace | 65.48 MiB | 16.95 MiB |
| Local proxy dependency trace | 61.80 MiB | 1.12 MiB |
| Staging deployed proxy | 24.30 MiB | 0.36 MiB |
| Staging deployed API bundle | 43.26 MiB | 23.52 MiB |
| Production deployed proxy | 24.29 MiB | 0.36 MiB |

Local dependency traces and deployed package sizes are different measurements.
Deduplicate physical function packages; routes can map to the same package.
Regional replication also affects storage (the proxy had eight regions).

Build, TypeScript, changed-file lint, eight targeted checks and the real Chrome
authentication test passed. Hosted staging login plus contacts, enquiries and
projects reads passed before and after the update. Its deployment is
`dpl_EHNXg5BRZVXQft9paiVbkSbR2JQt`, built from hosted baseline `c2d0a9e` with
hosting-only commit `8e6677c`. Pending R10 code and migrations were excluded.

Production deployment `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a` was built from its
existing hosted baseline `160becb` with hosting-only commit `adcffc8`. Both
isolated releases change exactly `auth.ts`, `auth.config.ts`, `auth-proxy.ts`,
`proxy.ts` and `next.config.ts`. No GitHub branch push or database migration ran.
Production login, tenant administration and both public sign-in domains passed
before and after promotion. Staging's normal domain and both persistent QA aliases
point to its optimized deployment; all production custom domains point to the
optimized production deployment. Original live deployments `dpl_4HVRqLuGyMJvD1yJnzNGgGqTFFXJ`
(production) and `dpl_7gLWS7iJUXW4bPrRAbKhxZWTRjYi` (staging) remain available
as rollback candidates. Use each project's scope and link when promoting one.

Function Storage is deployment code, separate from client uploads in Supabase.
Removing deployments reduces retained artifacts but does not erase already
accrued GB-month usage or guarantee uninterrupted future free-tier service.

References: [storage accounting](https://vercel.com/docs/deployment-storage),
[optimization](https://vercel.com/docs/deployment-storage/optimize),
[ignored build steps](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel),
[Auth.js split configuration](https://authjs.dev/guides/edge-compatibility).
