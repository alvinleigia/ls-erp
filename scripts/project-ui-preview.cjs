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
import { SessionProvider } from 'next-auth/react';
import { BusinessModuleProvider } from '@/platform/module-provider';
import { ApplicationCrmProvider } from '@/application/crm/provider';
import { EnquiryEditor } from '@/modules/crm/components/enquiry-editor';
import { OpportunityEditor } from '@/modules/crm/components/opportunity-editor';
import { ContactEditor } from '@/modules/crm/components/contact-editor';
import { AccountEditor } from '@/modules/crm/components/account-editor';
import { WorkEditor } from '@/modules/crm/components/work-editor';
import { ActivityPlanEditor } from '@/modules/crm/components/activity-plan-editor';
import { FollowUpRuleEditor } from '@/modules/crm/components/follow-up-rule-editor';
import { PipelineEditor } from '@/modules/crm/components/pipeline-editor';
import { SalesTeamEditor } from '@/modules/crm/components/sales-teams';
import { CustomFieldEditor } from '@/modules/crm/components/custom-field-configuration';
import { QuotationEditor } from '@/modules/sales-documents/components/quotations';
import { LeadSourceList } from '@/modules/crm/components/lead-source-list';
import { LostReasonList } from '@/modules/crm/components/lost-reason-list';
import { PropertyChoiceEditor } from '@/modules/real-estate/components/choice-editor';
import { ActivityTypeList } from '@/modules/crm/components/activity-type-list';
function Preview(){
 const path=usePathname().split('/'), query=useSearchParams(), key=path[2]==='configuration'?path[3]:path[2], raw=path[2]==='configuration'?path[4]:path[3], id=raw==='new'?undefined:raw;
 if(key==='projects')return <ProjectEditor key={id || query.get('parentId') || 'new'} id={id} parentId={query.get('parentId') || undefined}/>;
 const editors:any={enquiries:EnquiryEditor,opportunities:OpportunityEditor,contacts:ContactEditor,accounts:AccountEditor,activities:WorkEditor,'activity-plans':ActivityPlanEditor,'follow-up-rules':FollowUpRuleEditor,pipelines:PipelineEditor,'sales-teams':SalesTeamEditor,'custom-fields':CustomFieldEditor,quotations:QuotationEditor,'quotation-templates':QuotationEditor,'lead-sources':LeadSourceList,'lost-reasons':LostReasonList,'activity-types':ActivityTypeList};
 const Editor=key==='real-estate'?PropertyChoiceEditor:editors[key];
 return <SessionProvider session={{user:{id:'admin',name:'Test Admin',role:'ADMIN'},expires:'2099-01-01'}}><BusinessModuleProvider><ApplicationCrmProvider>{Editor && <Editor key={key+raw} id={key==='real-estate'?path[5]:id} kind={path[4]} template={key==='quotation-templates'} revision={Number(query.get('revision'))||undefined}/>}</ApplicationCrmProvider></BusinessModuleProvider></SessionProvider>
}
export default function Page(){return <Suspense><Preview/></Suspense>}`)
const cli = path.join(root, "node_modules/next/dist/bin/next")
process.argv = [process.execPath, cli, "dev", base, "--webpack", "--hostname", "127.0.0.1", "--port", "3012"]
require(cli)
