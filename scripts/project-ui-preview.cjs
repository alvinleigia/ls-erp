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
import InventoryCategories from '@/app/(protected)/inventory/categories/page';
import InventoryProducts from '@/app/(protected)/inventory/page';
import InventorySuppliers from '@/app/(protected)/inventory/suppliers/page';
import InventoryPurchases from '@/app/(protected)/inventory/purchases/page';
import Services from '@/app/(protected)/services/page';
import ServiceCategories from '@/app/(protected)/services/categories/page';
import { CoreViewGuard } from '@/platform/core/view-guard';
import Settings from '@/app/(protected)/settings/page';
import Taxes from '@/app/(protected)/settings/taxes/page';
import Dashboard from '@/app/(protected)/dashboard/page';
import CouponUsageReport from '@/app/(protected)/reports/coupon-usage/page';
import AuditLogsReport from '@/app/(protected)/reports/audit-logs/page';
import Leaves from '@/app/(protected)/leaves/page';
import LeaveGroups from '@/app/(protected)/leaves/groups/page';
import LeaveRequests from '@/app/(protected)/leaves/requests/page';
import LeaveApprovals from '@/app/(protected)/leaves/approvals/page';
import NewLeave from '@/app/(protected)/leaves/new/page';
import NewLeaveGroup from '@/app/(protected)/leaves/groups/new/page';
import Shifts from '@/app/(protected)/shifts/page';
import ShiftSchedules from '@/app/(protected)/shifts/schedules/page';
import RecurringPlans from '@/app/(protected)/shifts/recurring/page';
import Roster from '@/app/(protected)/shifts/roster/page';
import Appointments from '@/app/(protected)/appointments/page';
import Coupons from '@/app/(protected)/appointments/coupons/page';
import { AppointmentOrderEditor } from '@/app/(protected)/appointments/appointment-order-editor';
import { AccessRoles } from '@/platform/access/role-controls';
import { BusinessViewGuard } from '@/platform/access/view-guard';
import { ModuleControls } from '@/platform/module-controls';
import TenantsPageClient from '@/app/(protected)/settings/tenants/tenants-page-client';
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
 if(path[1]==='dashboard' || path[1]==='settings' && (!path[2] || path[2]==='taxes'))return <BusinessModuleProvider><CoreViewGuard role={query.get('role')||'MANAGER'} userId='manager'>{path[1]==='dashboard'?<Dashboard/>:path[2]==='taxes'?<Taxes/>:<Settings/>}</CoreViewGuard></BusinessModuleProvider>;
 if(path[1]==='reports')return <BusinessModuleProvider><CoreViewGuard role={query.get('role')||'MANAGER'} userId='manager'>{path[2]==='coupon-usage'?<CouponUsageReport/>:<AuditLogsReport/>}</CoreViewGuard></BusinessModuleProvider>;
 if(path[1]==='leaves')return <BusinessModuleProvider><BusinessViewGuard module='leaves' role={query.get('role')||'MANAGER'}><SessionProvider session={{user:{id:'manager',name:'Test Manager',role:query.get('role')==='STAFF'?'STAFF':query.get('role')==='ADMIN'?'ADMIN':'MANAGER'},expires:'2099-01-01'}}><div className='min-w-0 [contain:inline-size]'>{path[2]==='requests'?<LeaveRequests/>:path[2]==='approvals'?<LeaveApprovals/>:path[2]==='new'?<NewLeave/>:path[2]==='groups'?(path[3]==='new'?<NewLeaveGroup/>:<LeaveGroups/>):<Leaves/>}</div></SessionProvider></BusinessViewGuard></BusinessModuleProvider>;
 if(path[1]==='shifts')return <BusinessModuleProvider><BusinessViewGuard module='shifts'><div className='min-w-0 [contain:inline-size]'>{path[2]==='schedules'?<ShiftSchedules/>:path[2]==='recurring'?<RecurringPlans/>:path[2]==='roster'?<Roster/>:<Shifts/>}</div></BusinessViewGuard></BusinessModuleProvider>;
 if(path[1]==='services')return <BusinessModuleProvider><BusinessViewGuard module='services'><div className='min-w-0 [contain:inline-size]'>{path[2]==='categories'?<ServiceCategories/>:<Services/>}</div></BusinessViewGuard></BusinessModuleProvider>;
 if(path[1]==='appointments')return <BusinessModuleProvider><BusinessViewGuard module='appointments'><div className='min-w-0 [contain:inline-size]'>{path[2]==='coupons'?<Coupons/>:path[2]==='new'?<AppointmentOrderEditor mode='create'/>:path[2]?<AppointmentOrderEditor key={path[2]} mode='edit' appointmentId={path[2]}/>:<Appointments/>}</div></BusinessViewGuard></BusinessModuleProvider>;
 if(path[1]==='inventory'){ const InventoryView=path[2]==='categories'?InventoryCategories:path[2]==='suppliers'?InventorySuppliers:path[2]==='purchases'?InventoryPurchases:InventoryProducts; return <BusinessModuleProvider><BusinessViewGuard module='inventory'><InventoryView/></BusinessViewGuard></BusinessModuleProvider>; }
 if(key==='roles')return <AccessRoles/>;
 if(key==='modules')return <ModuleControls tenantId={query.get('tenant') || undefined}/>;
 if(key==='tenants')return <TenantsPageClient rootDomain='example.test' platformAccessMode='SUPER_ADMIN'/>;
 if(key==='projects')return <BusinessModuleProvider><ProjectEditor key={id || query.get('parentId') || 'new'} id={id} parentId={query.get('parentId') || undefined}/></BusinessModuleProvider>;
 const editors:any={enquiries:EnquiryEditor,opportunities:OpportunityEditor,contacts:ContactEditor,accounts:AccountEditor,activities:WorkEditor,'activity-plans':ActivityPlanEditor,'follow-up-rules':FollowUpRuleEditor,pipelines:PipelineEditor,'sales-teams':SalesTeamEditor,'custom-fields':CustomFieldEditor,quotations:QuotationEditor,'quotation-templates':QuotationEditor,'lead-sources':LeadSourceList,'lost-reasons':LostReasonList,'activity-types':ActivityTypeList};
 const Editor=key==='real-estate'?PropertyChoiceEditor:editors[key];
 return <SessionProvider session={{user:{id:'admin',name:'Test Admin',role:'ADMIN'},expires:'2099-01-01'}}><BusinessModuleProvider><ApplicationCrmProvider><BusinessViewGuard>{Editor && <Editor key={key+raw} id={key==='real-estate'?path[5]:id} kind={path[4]} enquiryId={query.get('enquiryId') || undefined} template={key==='quotation-templates'} revision={Number(query.get('revision'))||undefined}/>}</BusinessViewGuard></ApplicationCrmProvider></BusinessModuleProvider></SessionProvider>
}
export default function Page(){return <Suspense><Preview/></Suspense>}`)
for (const route of ['leaves/[id]', 'leaves/groups/[id]']) {
 fs.mkdirSync(path.join(base, 'app', route), { recursive: true });
 write('app/'+route+'/page.tsx', '"use client"; import View from "@/app/(protected)/'+route+'/page"; import { BusinessModuleProvider } from "@/platform/module-provider"; import { BusinessViewGuard } from "@/platform/access/view-guard"; export default function Page(){return <BusinessModuleProvider><BusinessViewGuard module="leaves"><View/></BusinessViewGuard></BusinessModuleProvider>}');
}
// Static routes must outrank the leave-definition [id] route, as in the real app.
for (const route of ['leaves/new', 'leaves/groups', 'leaves/groups/new', 'leaves/requests', 'leaves/approvals']) {
 fs.mkdirSync(path.join(base, 'app', route), { recursive: true });
 write('app/'+route+'/page.tsx', 'export { default } from "../../' + (route.split('/').length === 3 ? '../' : '') + '[[...route]]/page"');
}
const cli = path.join(root, "node_modules/next/dist/bin/next")
process.argv = [process.execPath, cli, "dev", base, "--webpack", "--hostname", "127.0.0.1", "--port", "3012"]
require(cli)
