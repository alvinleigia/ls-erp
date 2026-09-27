/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { chromium } = require("@playwright/test")
const directory = path.resolve(__dirname, "../.playwright-auth")
const targetFile = path.join(directory, "target.json")
const endpoint = "http://127.0.0.1:9223"

async function main() {
  const command = process.argv[2]
  const previous = fs.existsSync(targetFile) ? JSON.parse(fs.readFileSync(targetFile, "utf8")) : {}
  const url = new URL(process.argv[3] || previous.baseURL || "https://salon.leigia.com")
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Provide an HTTP(S) app URL without credentials.")
  let baseURL = url.origin
  if (command === "open") {
    fs.mkdirSync(directory, { recursive: true })
    let running = false
    try { running = (await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })).ok } catch { /* Start dedicated Chrome below. */ }
    if (running && !previous.baseURL) throw new Error("Port 9223 is already in use. Close that debugging browser before linking this project's profile.")
    if (!running) {
      const executable = [process.env.CRM_BROWSER_EXECUTABLE, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(file => file && fs.existsSync(file))
      if (!executable) throw new Error("Chrome not found. Set CRM_BROWSER_EXECUTABLE to your Chrome executable.")
      const child = spawn(executable, ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9223", `--user-data-dir=${path.join(directory, "chrome")}`, "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank"], { detached: true, stdio: "ignore" })
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
      child.unref()
    }
    let browser
    for (let attempt = 0; attempt < 30; attempt++) {
      try { browser = await chromium.connectOverCDP(endpoint, { timeout: 1000 }); break } catch { await new Promise(resolve => setTimeout(resolve, 300)) }
    }
    if (!browser) throw new Error("Chrome did not expose its local testing connection on port 9223.")
    try {
      const context = browser.contexts()[0]
      const page = context.pages().find(page => page.url().startsWith(`${baseURL}/`)) || context.pages().find(page => page.url() === "about:blank") || await context.newPage()
      if (!page.url().startsWith(`${baseURL}/`)) await page.goto(`${baseURL}/auth/signin`)
      const destination = new URL(page.url())
      if (destination.hostname !== url.hostname || !["http:", "https:"].includes(destination.protocol)) throw new Error("The app redirected to a different host. Reopen using its intended tenant URL.")
      baseURL = destination.origin
      fs.writeFileSync(targetFile, JSON.stringify({ baseURL }, null, 2))
      console.log(`Browser linked at ${endpoint}. Sign in at ${baseURL}, then run npm run browser:save.`)
    } finally { await browser.close() } // Disconnect only: Chrome was launched separately.
    return
  }
  if (!["save", "status"].includes(command)) throw new Error("Use open [app URL], save, or status.")
  if (!previous.baseURL) throw new Error("Run npm run browser:open first.")
  const browser = await chromium.connectOverCDP(endpoint)
  try {
    const context = browser.contexts()[0]
    const response = await context.request.get(`${baseURL}/api/auth/session`)
    const session = await response.json()
    if (!response.ok() || !session?.user?.id || !session?.user?.tenantId) throw new Error("Sign in to the selected app in the linked Chrome window first.")
    if (command === "save") {
      await context.storageState({ path: path.join(directory, "session.json") })
      fs.writeFileSync(targetFile, JSON.stringify({ baseURL, tenantId: session.user.tenantId, userId: session.user.id, savedAt: new Date().toISOString() }, null, 2))
      console.log("Session saved privately in .playwright-auth/session.json. Run npm run test:browser.")
    } else console.log(`Linked browser authenticated at ${baseURL}; tenant ${session.user.tenantSlug || session.user.tenantId}.`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
