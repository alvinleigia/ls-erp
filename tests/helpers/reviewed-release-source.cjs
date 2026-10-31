/* eslint-disable @typescript-eslint/no-require-imports */
// Historical gates must validate the immutable source they reviewed, not today's schema.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { execFileSync } = require('node:child_process')
module.exports = function reviewedSource(t, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('A pinned source commit is required.')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-erp-reviewed-source-'))
  t.after(() => {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('ls-erp-reviewed-source-')) throw Error('Unexpected fixture directory.')
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const archive = path.join(directory, 'source.tar')
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, commit, 'prisma', ...(commit === '740cfc527a47aae55b397c5572fde080500e42b5' ? [] : ['docs/release-source-r10.json'])], { windowsHide: true })
  execFileSync('tar', ['-xf', archive, '-C', directory], { windowsHide: true })
  return directory
}
