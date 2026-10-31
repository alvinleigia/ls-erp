/* eslint-disable @typescript-eslint/no-require-imports */
// Local rehearsal tooling only. Never loads dotenv or writes to a database.
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { Client } = require("pg")
const root = path.resolve(__dirname, "..")
const manifestPath = path.join(root, "docs/industry-release-manifest.json")
const sha = value => crypto.createHash("sha256").update(value).digest("hex")
const lf = value => value.toString().replace(/\r\n/g, "\n")
const qi = value => '"' + value.replaceAll('"', '""') + '"'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function verifySource(manifest, sourceRoot = root) {
  const directory = path.join(sourceRoot, "prisma/migrations")
  const names = fs.readdirSync(directory).filter(name => fs.statSync(path.join(directory, name)).isDirectory()).sort()
  if (!same(names, manifest.migrations.map(item => item.name))) throw Error("Migration inventory differs from the reviewed manifest.")
  for (const item of manifest.migrations) {
    const sql = lf(fs.readFileSync(path.join(directory, item.name, "migration.sql")))
    if (sha(sql) !== item.sha256Lf) throw Error(`Migration checksum mismatch: ${item.name}`)
    // Twelve historical files were deployed with only their final newline CRLF.
    // Prove this exact encoding from unchanged SQL; never accept an arbitrary hash.
    if (item.sha256LfFinalCrlf && (item.phase !== 'baseline' || !sql.endsWith('\n') || sha(sql.slice(0, -1) + '\r\n') !== item.sha256LfFinalCrlf)) throw Error(`Historical newline checksum mismatch: ${item.name}`)
  }
  if (sha(lf(fs.readFileSync(path.join(sourceRoot, "prisma/schema.prisma")))) !== manifest.schemaSha256Lf) throw Error("Schema differs from the reviewed manifest.")
}

function localUrl(raw) {
  let url
  try { url = new URL(raw) } catch { throw Error("Set RECONCILE_DATABASE_URL to the isolated local rehearsal database.") }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || !(/^\/ls_erp_rehearsal(?:_[a-f0-9]{12})?$/.test(url.pathname) || url.pathname === '/ls_salon_crm_test') || url.search || url.hash) throw Error("Only local ls_erp_rehearsal or ls_salon_crm_test databases are allowed, without URL parameters.")
  return url.toString()
}
function outputPath(name) {
  const base = path.join(root, "tmp", "industry-release"), target = path.resolve(base, name || "")
  if (!name || path.dirname(target) !== base || !target.endsWith(".json")) throw Error("Use a JSON filename inside tmp/industry-release.")
  return target
}
function migrationProblems(rows, manifest, phase) {
  const errors = [], known = new Map(manifest.migrations.map(item => [item.name, item]))
  const expected = manifest.migrations.filter(item => phase === "after" || item.phase === "baseline")
  const completed = new Set()
  for (const row of rows) {
    if (row.rolledBack) continue
    const item = known.get(row.name)
    if (!item) { errors.push(`Unknown migration: ${row.name}`); continue }
    if (!row.finished) errors.push(`Unfinished migration: ${row.name}`)
    const checksums = [item.sha256Lf, item.sha256Crlf, item.sha256LfFinalCrlf].filter(Boolean)
    if (!checksums.includes(row.checksum)) errors.push(`Applied checksum mismatch: ${row.name}`)
    if (completed.has(row.name)) errors.push(`Duplicate migration history: ${row.name}`)
    if (phase === "before" && item.phase !== "baseline") errors.push(`Release migration already present in before snapshot: ${row.name}`)
    completed.add(row.name)
  }
  for (const item of expected) if (!completed.has(item.name)) errors.push(`Missing migration: ${item.name}`)
  return errors
}

async function rowIdentity(db, relation) {
  const primaryKey = (await db.query(`SELECT a.attname AS name FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.pos`, [relation])).rows.map(row => row.name)
  if (primaryKey.length) return { primaryKey }
  // Auth verification tokens use non-null unique keys rather than a primary key.
  // Partial, expression, nullable or deferred uniqueness cannot identify every row.
  const uniqueKey = (await db.query(`SELECT ci.relname AS name, array_agg(a.attname::text ORDER BY k.pos) AS columns
    FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,pos)
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
    WHERE i.indrelid=$1::regclass AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND k.pos<=i.indnkeyatts
    GROUP BY ci.relname HAVING bool_and(a.attnotnull) ORDER BY count(*),ci.relname LIMIT 1`, [relation])).rows[0]
  if (!uniqueKey) throw Error(`Cannot reconcile table without a non-null unique row identity: ${relation}`)
  return { primaryKey, uniqueKey }
}

async function capture(rawUrl, { canonicalConstraints = false } = {}) {
  const db = new Client({ connectionString: localUrl(rawUrl) })
  await db.connect()
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    await db.query("SET LOCAL statement_timeout = '120s'")
    await db.query("SET LOCAL lock_timeout = '5s'")
    await db.query("SET LOCAL TIME ZONE 'UTC'")
    await db.query("SET LOCAL DateStyle = 'ISO, YMD'")
    await db.query("SET LOCAL row_security = off")
    await db.query("SET LOCAL search_path = pg_catalog, public")
    const role = (await db.query("SELECT rolsuper OR rolbypassrls AS complete FROM pg_roles WHERE rolname=current_user")).rows[0]
    if (!role?.complete) throw Error("Reconciliation requires a local backup-reader role with complete RLS visibility; use a separate runtime role for access tests.")
    const tables = (await db.query(`SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'_prisma_migrations' ORDER BY c.relname`)).rows
    // Format 3 uses PostgreSQL's own canonical constraint deparser for dump/restore
    // comparisons. Format 2 and the historical R5 comparison remain unchanged.
    const snapshot = { format: canonicalConstraints ? 3 : 2, serverMajor: (await db.query("SHOW server_version_num")).rows[0].server_version_num.slice(0, -4), tables: {}, foreignKeyViolations: [], migrations: [] }
    snapshot.schemaObjects = {
      enums: (await db.query("SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname")).rows,
      isolationFunctions: (await db.query("SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments, md5(pg_get_functiondef(p.oid)) AS hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prokind='f' ORDER BY p.proname, arguments")).rows,
    }
    for (const table of tables) {
      const relation = `public.${qi(table.name)}`
      const columns = (await db.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS "default"
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [relation])).rows
      const identity = await rowIdentity(db, relation)
      const identityColumns = identity.primaryKey.length ? identity.primaryKey : identity.uniqueKey.columns
      const constraints = (await db.query(`SELECT conname AS name, contype AS type, convalidated AS validated, pg_get_constraintdef(oid${canonicalConstraints ? ',true' : ''}) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname`, [relation])).rows
      if (constraints.some(c => !c.validated)) throw Error(`Unvalidated constraints: ${table.name}`)
      const indexes = (await db.query("SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [table.name])).rows
      if ((await db.query("SELECT 1 FROM pg_index WHERE indrelid=$1::regclass AND (NOT indisvalid OR NOT indisready)", [relation])).rowCount) throw Error(`Invalid index: ${table.name}`)
      const policies = (await db.query("SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY policyname", [table.name])).rows
      const tenant = columns.some(c => c.name === "tenantId") ? 't."tenantId"' : table.name === "Tenant" ? 't.id' : 'NULL::text'
      const identitySql = `jsonb_build_array(${identityColumns.map(key => `t.${qi(key)}`).join(',')})::text`
      await db.query(`DECLARE reconcile_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS data, ${identitySql} AS identity, ${tenant} AS tenant FROM ${relation} t ORDER BY (${identitySql}) COLLATE "C"`)
      const partitions = new Map()
      for (;;) {
        const batch = (await db.query("FETCH FORWARD 500 FROM reconcile_rows")).rows
        if (!batch.length) break
        for (const row of batch) {
          const key = row.tenant === null ? "global" : `tenant:${row.tenant}`
          if (!partitions.has(key)) partitions.set(key, { count: 0, content: crypto.createHash('sha256'), ids: crypto.createHash('sha256') })
          const part = partitions.get(key); part.count++
          part.content.update(row.data).update('\n'); part.ids.update(row.identity).update('\n')
        }
      }
      await db.query("CLOSE reconcile_rows")
      snapshot.tables[table.name] = { columns, ...identity, constraints, indexes, rls: table.rls, force: table.force, policies,
        partitions: Object.fromEntries([...partitions].sort(([a], [b]) => a.localeCompare(b)).map(([key, p]) => [key, { count: p.count, content: p.content.digest('hex'), ids: p.ids.digest('hex') }])) }
    }
    const fks = (await db.query(`SELECT c.conname AS name, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, c.confmatchtype AS match,
      array_agg(a.attname::text ORDER BY k.pos) AS local, array_agg(b.attname::text ORDER BY k.pos) AS remote
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(src,dst,pos)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.src JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.dst
      WHERE c.contype='f' AND n.nspname='public' GROUP BY c.oid ORDER BY c.conname`)).rows
    for (const fk of fks) {
      const present = fk.local.map(key => `s.${qi(key)} IS NOT NULL`), equal = fk.local.map((key, i) => `s.${qi(key)}=p.${qi(fk.remote[i])}`)
      const partialNull = fk.match === 'f' ? ` OR ((${present.join(' OR ')}) AND NOT (${present.join(' AND ')}))` : ''
      // regclass text is generated by PostgreSQL, not supplied by a request.
      const count = (await db.query(`SELECT count(*)::text AS count FROM ${fk.child} s WHERE ((${present.join(' AND ')}) AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${equal.join(' AND ')}))${partialNull}`)).rows[0].count
      if (count !== '0') snapshot.foreignKeyViolations.push({ name: fk.name, count })
    }
    snapshot.migrations = (await db.query('SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM public._prisma_migrations ORDER BY migration_name, id')).rows
    snapshot.financialTotals = {}
    for (const [table, column] of [['CrmOpportunity', 'amount'], ['CrmQuotation', 'consideration']]) {
      if (snapshot.tables[table]) snapshot.financialTotals[table] = (await db.query(`SELECT "tenantId", currency, count(*)::text AS count, sum(${qi(column)})::text AS amount FROM public.${qi(table)} GROUP BY "tenantId", currency ORDER BY "tenantId", currency`)).rows
    }
    await db.query("COMMIT")
    return snapshot
  } finally { await db.end() }
}

function compare(before, after, manifest) {
  const errors = []
  if (before.format !== 2 || after.format !== 2 || before.serverMajor !== after.serverMajor) errors.push("Snapshot format or PostgreSQL major version mismatch.")
  errors.push(...migrationProblems(before.migrations, manifest, "before"), ...migrationProblems(after.migrations, manifest, "after"))
  if (before.foreignKeyViolations.length || after.foreignKeyViolations.length) errors.push("Foreign-key violations present.")
  if (!same(before.schemaObjects, after.schemaObjects)) errors.push('Enum or isolation function definitions changed.')
  if (!same(before.financialTotals, after.financialTotals)) errors.push('Stored financial totals changed.')
  for (const name of manifest.baselineTables) if (!before.tables[name]) errors.push(`Missing baseline table: ${name}`)
  for (const [name, old] of Object.entries(before.tables)) {
    const next = after.tables[name]
    if (!next) { errors.push(`Missing table: ${name}`); continue }
    if (!same(old.partitions, next.partitions)) errors.push(`Records changed: ${name}`)
    const withoutIndexes = table => Object.fromEntries(Object.entries(table).filter(([key]) => key !== 'indexes' && key !== 'partitions'))
    if (!same(withoutIndexes(old), withoutIndexes(next))) errors.push(`Unexpected table schema/security change: ${name}`)
    if (name === 'ShiftSchedule') {
      const oldIndex = old.indexes.find(i => i.name === 'ShiftSchedule_default_unique')
      const newIndex = next.indexes.find(i => i.name === 'ShiftSchedule_tenant_default_unique')
      if (!oldIndex || oldIndex.definition !== manifest.previousShiftDefaultIndexDefinition || !newIndex || newIndex.definition !== manifest.shiftDefaultIndexDefinition || next.indexes.some(i => i.name === oldIndex.name)) errors.push('Default shift index does not match release contract.')
      if (!same(old.indexes.filter(i => i !== oldIndex), next.indexes.filter(i => i !== newIndex))) errors.push('Unexpected ShiftSchedule index changes.')
    } else if (!same(old.indexes, next.indexes)) errors.push(`Unexpected indexes: ${name}`)
  }
  for (const name of Object.keys(manifest.addedTables)) {
    if (before.tables[name]) errors.push(`New table already exists before release: ${name}`)
    if (!after.tables[name]) { errors.push(`Missing added table: ${name}`); continue }
    const { partitions, ...schema } = after.tables[name]
    if (Object.keys(partitions).length) errors.push(`New table is not empty: ${name}`)
    if (!same(schema, manifest.addedTables[name])) errors.push(`Added table schema/security mismatch: ${name}`)
  }
  for (const name of Object.keys(after.tables)) if (!before.tables[name] && !manifest.addedTables[name]) errors.push(`Unexpected added table: ${name}`)
  return errors
}

async function main() {
  const [command, first, second] = process.argv.slice(2), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  verifySource(manifest)
  if (command === 'verify') return console.log(`Verified ${manifest.migrations.length} migration checksums and the Prisma schema. No database connection.`)
  if (command === 'capture') {
    const file = outputPath(first)
    if (fs.existsSync(file)) throw Error('Snapshot already exists; choose a fresh filename.')
    const snapshot = await capture(process.env.RECONCILE_DATABASE_URL)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    return console.log(`Captured ${Object.keys(snapshot.tables).length} tables. Read-only snapshot saved under tmp/industry-release; no raw records included.`)
  }
  if (command === 'compare') {
    const errors = compare(JSON.parse(fs.readFileSync(outputPath(first))), JSON.parse(fs.readFileSync(outputPath(second))), manifest)
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; return }
    return console.log('Reconciliation passed: existing records, identities, schema/security and expected migration changes match.')
  }
  throw Error('Usage: node scripts/industry-release.cjs verify | capture filename.json | compare before.json after.json')
}
module.exports = { capture, compare, migrationProblems, localUrl, outputPath, verifySource, sha, lf, rowIdentity }
if (require.main === module) main().catch(error => { console.error(error.code ? `Release check failed (${error.code}); inspect the protected local environment.` : error.message); process.exitCode = 1 })
