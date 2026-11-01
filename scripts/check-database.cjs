/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), dotenv = require('dotenv')
const { targets, localUrl, hostedUrl, migrations, checkHistory } = require('./database-workflow.cjs')
const { Client } = require('pg')
async function main() {
  const target = process.argv[2], file = { local: '.env.local-demo', staging: '.env.new-vercel-staging', production: '.env.new-vercel' }[target]
  if (!file) throw Error('Specify local, staging or production. This command only checks; it never changes a database.')
  const env = dotenv.parse(fs.readFileSync(file)), url = env.MIGRATION_DATABASE_URL || env.DIRECT_URL
  if (target === 'local') localUrl(url); else hostedUrl(url, targets[target], true)
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 15000 }); await db.connect()
  try {
    const pending = checkHistory(migrations(), (await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations')).rows)
    console.log(JSON.stringify({ environment: target, applied: migrations().length - pending.length, pending, readOnly: true }, null, 2))
  } finally { await db.end() }
}
main().catch(() => { console.error('Database check failed. Confirm the selected environment, connection and immutable migration history.'); process.exitCode = 1 })
