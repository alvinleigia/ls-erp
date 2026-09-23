/* eslint-disable @typescript-eslint/no-require-imports */
// Node's built-in test runner plus the project's existing TypeScript compiler.
// Only test processes install this loader; application runtime is unchanged.
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const ts = require("typescript")
const root = path.resolve(__dirname, "..")
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, ...args)
}
require.extensions[".ts"] = function (loaded, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  })
  loaded._compile(output.outputText, filename)
}
