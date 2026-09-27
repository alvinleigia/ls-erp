# Project workflow

Read `docs/CONVENTIONS.md` for implementation conventions and
`docs/MODULAR_PLATFORM.md` for the current CRM architecture and verified milestones.

## Browser testing with Codex

Follow `docs/BROWSER_TESTING.md`. This project uses the same dedicated Chrome and
saved Playwright login approach as ls-chatbot/LIA. The default target is
`https://salon.leigia.com`; the selected target is stored locally by `browser:open`.

- `npm.cmd run browser:open` opens the dedicated browser. The user signs in there.
- After the user confirms login, run `npm.cmd run browser:save`, then
  `npm.cmd run test:browser:connection` or the relevant `test:browser` tests.
- For interactive inspection, use the installed Playwright library to attach
  to `http://127.0.0.1:9223`. Inspect current pages and visible locators first.
- Use saved-session tests for repeatable checks, screenshots and traces. Inspect
  relevant screenshots before claiming visual verification.
- Never commit or print browser session secrets. `.playwright-auth` is separate
  from test output and must not be removed during routine report cleanup.
- The default suite is read-only. New tests that save business changes should
  target isolated test data within the user's authorized scope. Do not run local
  fixture/seed/reset scripts against the hosted app's database.
- A linked browser does not imply that the latest local code is deployed. Report
  missing hosted features separately from local test results.
