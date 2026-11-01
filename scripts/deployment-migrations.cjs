/* eslint-disable @typescript-eslint/no-require-imports */
const { hostedTarget, hostedUrl, migrate } = require('./database-workflow.cjs')
async function main() {
  if (process.env.VERCEL !== '1') { console.log('Hosted migration hook skipped outside Vercel. Local demo manages its own database.'); return }
  const target = hostedTarget(process.env)
  hostedUrl(process.env.DATABASE_URL, target)
  const direct = process.env.MIGRATION_DATABASE_URL || process.env.DIRECT_URL
  hostedUrl(direct, target, true)
  console.log(`Verifying ${target.name} database before the application build.`)
  await migrate(direct, { apply: target.name === 'staging' })
}
if (require.main === module) main().catch(error => {
  // Known guard messages contain only code-owned context, never credentials.
  const known = /^(?:Database |Applied migration |An unfinished |An older |A nonempty |Migrations |Migration |\d+ pending migrations)/.test(error.message)
  console.error(`Database pre-build check failed: ${known ? error.message : `connection/command error${/^[A-Z0-9]{5}$/.test(error.code || '') ? ` (${error.code})` : ''}`}`)
  console.error('Verify the selected environment with db:check. Pending production migrations require the controlled release.')
  process.exitCode = 1
})
module.exports = { main }
