/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test host. */
// Isolated component host: no authentication, server APIs or database imports.
// Playwright intercepts all API requests in project-detail.spec.ts.
const fs = require("node:fs")
const path = require("node:path")
const root = path.resolve(__dirname, "..")
const base = path.join(root, "test-results/project-ui-host")
fs.mkdirSync(path.join(base, "app/[[...route]]"), { recursive: true })
function write(file, text) { fs.writeFileSync(path.join(base, file), text, "utf8") }
write("package.json", JSON.stringify({ private: true }))
write("next.config.mjs", "export default { devIndicators: false, experimental: { externalDir: true } }")
write("postcss.config.mjs", "export { default } from '../../postcss.config.mjs'")
write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "esnext"], strict: true, skipLibCheck: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", jsx: "react-jsx", noEmit: true, resolveJsonModule: true, isolatedModules: true, plugins: [{ name: "next" }], paths: { "@/*": ["../../*"] } }, include: ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"] }))
write("app/layout.tsx", `import '../../../app/globals.css'; export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en" className="dark"><body style={{fontFamily:'Arial,sans-serif'}}><div className="flex min-h-screen"><aside className="hidden w-64 shrink-0 border-r p-6 lg:block">Real Estate</aside><main className="min-w-0 flex-1 p-4 sm:p-8" style={{containerType:'inline-size'}}>{children}</main></div></body></html> }`)
write("app/[[...route]]/page.tsx", `"use client";
import {Suspense} from 'react'; import {usePathname,useSearchParams} from 'next/navigation';
import {ProjectEditor} from '@/modules/real-estate/components/project-editor';
function Preview(){ const path=usePathname().split('/'), query=useSearchParams(), id=path[3]==='new'?undefined:path[3]; return <ProjectEditor key={id || query.get('parentId') || 'new'} id={id} parentId={query.get('parentId') || undefined}/> }
export default function Page(){return <Suspense><Preview/></Suspense>}`)
const cli = path.join(root, "node_modules/next/dist/bin/next")
process.argv = [process.execPath, cli, "dev", base, "--webpack", "--hostname", "127.0.0.1", "--port", "3012"]
require(cli)
