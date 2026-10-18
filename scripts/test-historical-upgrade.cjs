/* eslint-disable @typescript-eslint/no-require-imports */
// Replays historical SQL with pre-upgrade synthetic records in a new internal
// Docker network. No host port, .env, hosted credentials or client data is used.
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { randomBytes } = require("node:crypto")
const { verifySource } = require("./industry-release.cjs")
const root = path.resolve(__dirname, "..")
const name = `ls-erp-history-${randomBytes(6).toString("hex")}`
const logDir = path.join(root, "tmp", "industry-release")
fs.mkdirSync(logDir, { recursive: true })
const report = path.join(logDir, `${name}.log`)
const log = fs.createWriteStream(report, { flags: "wx", mode: 0o600 })

function docker(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true })
    const chunks = []
    child.stdout.on("data", data => { chunks.push(data); log.write(data) })
    child.stderr.on("data", data => log.write(data))
    child.on("error", reject)
    child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error(`Docker step failed (${code}); see ${report}`)))
  })
}

async function main() {
  const cutover = process.argv.length === 3 && process.argv[2] === "--cutover"
  if (process.argv.length > 2 && !cutover) throw new Error("Usage: node scripts/test-historical-upgrade.cjs [--cutover]")
  verifySource(require("../docs/industry-release-manifest.json"))
  // Use already installed images, pinned by their immutable local IDs. No pulls.
  const postgres = (await docker(["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"])).trim()
  const node = (await docker(["image", "inspect", "node:24-alpine", "--format", "{{.Id}}"])).trim()
  let network = false, container = false
  try {
    await docker(["network", "create", "--internal", name]); network = true
    await docker(["run", "--detach", "--name", name, "--network", name,
      "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
      "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=ls_salon_crm_test", postgres], { POSTGRES_PASSWORD: randomBytes(32).toString("hex") }); container = true
    for (let i = 0; ; i++) {
      try { await docker(["exec", name, "pg_isready", "-U", "postgres", "-d", "ls_salon_crm_test"]); break }
      catch (error) { if (i >= 29) throw error; await new Promise(resolve => setTimeout(resolve, 500)) }
    }
    const sources = ["node_modules", "prisma/migrations", "docs/industry-release-manifest.json", "tests", "application", "modules", "platform", "lib", "types", "package.json"]
    const mounts = sources.flatMap(src => ["--mount", `type=bind,source=${path.join(root, src)},target=/work/${src},readonly`])
    const env = { CRM_TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/ls_salon_crm_test", DATABASE_URL: "postgresql://crm_test_runtime@127.0.0.1:5432/ls_salon_crm_test", NODE_ENV: "test", R5_HISTORICAL_CONTAINER: "1",
      CRM_TEST_EXPECT_UPGRADE_FIXTURE: "1", CRM_TEST_EXPECT_INTAKE_UPGRADE: "1", CRM_TEST_EXPECT_PROJECT_UPGRADE: "1", CRM_TEST_EXPECT_CHOICES_UPGRADE: "1" }
    const args = ["run", "--rm", "--network", `container:${name}`, "--workdir", "/work", ...Object.keys(env).flatMap(key => ["--env", key]), ...mounts, node, "node"]
    console.log("Replaying migrations with pre-upgrade fixtures in an isolated database.")
    console.log((await docker([...args, "tests/helpers/historical-upgrade.cjs"], env)).trim())
    console.log(cutover ? "Rehearsing runtime connection freeze, drain and recovery." : "Running CRM and property integration suites with all four upgrade checks enabled.")
    const files = cutover ? ["tests/cutover-freeze.integration.test.cjs"] : ["tests/crm.integration.test.cjs", "tests/real-estate.integration.test.cjs"]
    const output = await docker([...args, "--require", "./tests/register.cjs", "--test", "--test-reporter=tap", "--test-concurrency=1", "--test-force-exit", ...files], env)
    console.log(output.split("\n").filter(line => /^# (tests|pass|fail|skipped|duration_ms)/.test(line)).join("\n"))
    if (!/^# skipped 0$/m.test(output)) throw new Error("Historical suite must not skip tests")
    console.log(`Evidence: ${path.relative(root, report)}`)
  } finally {
    if (container) await docker(["rm", "--force", name])
    if (network) await docker(["network", "rm", name])
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => log.end())
