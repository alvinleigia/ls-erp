/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{Client}=require('pg')
const {resourceKeys}=require('../platform/access/catalog.ts'),{ownershipParts}=require('../platform/access/resource-registry.ts')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const db=new Client({connectionString:raw}),parts=resourceKeys.flatMap(resource=>ownershipParts(resource).map(part=>({resource,...part})))
let tables,parents
before(async()=>{
 await db.connect()
 tables=new Map((await db.query(`SELECT c.relname AS name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
   EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='officeId' AND NOT a.attisdropped AND a.attnotnull) AS office_required,
   EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND NOT p.polpermissive) AS restrictive,
   (SELECT jsonb_agg(jsonb_build_object('command',p.polcmd,'qual',pg_get_expr(p.polqual,p.polrelid))) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polcmd IN ('*','r')) AS read_policies,
   EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_class parent ON parent.oid=k.confrelid WHERE k.conrelid=c.oid AND k.contype='f' AND parent.relname='BusinessOffice') AS office_fk
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`)).rows.map(row=>[row.name,row]))
 parents=new Map()
 for(const row of(await db.query(`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint k JOIN pg_class child ON child.oid=k.conrelid JOIN pg_class parent ON parent.oid=k.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace WHERE n.nspname='public' AND k.contype='f'`)).rows){if(!parents.has(row.child))parents.set(row.child,new Set());parents.get(row.child).add(row.parent)}
})
after(async()=>await db.end())
const reaches=(model,targets)=>{const queue=[model],seen=new Set();while(queue.length){const node=queue.shift();if(targets.has(node))return true;if(seen.has(node))continue;seen.add(node);queue.push(...(parents.get(node)??[]))}return false}
test('every registered business root and child exists with forced RLS',()=>{
 for(const model of new Set(parts.flatMap(part=>[...part.roots,...(part.children??[])]))){const row=tables.get(model);assert.ok(row,model+': missing table');assert.ok(row.enabled&&row.forced,model+': missing forced RLS')}
})
test('every native office root has required office identity, foreign key and forced office Read RLS',()=>{
 for(const part of parts.filter(part=>part.kind==='office'))for(const model of part.roots){const row=tables.get(model);assert.ok(row,model);assert.ok(row.office_required,model+': nullable office');assert.ok(row.office_fk,model+': missing office FK');assert.ok(row.enabled&&row.forced,model+': missing forced RLS')
  if(!row.restrictive){
   // New private stock tables have no broad tenant policy to restrict. Verify
   // their complete permissive Read set instead of assuming a policy spelling.
   const office='app.inventory_office_read("tenantId", "officeId")',bypass="(current_setting('app.rls_bypass'::text, true) = 'on'::text)"
   assert.ok(row.read_policies.some(policy=>policy.qual===office),model+': missing office guard')
   assert.ok(row.read_policies.every(policy=>[office,bypass].includes(policy.qual)),model+': broader permissive Read')
  }}
})
test('source roots retain canonical ancestry instead of duplicated mutable offices',()=>{
 for(const part of parts.filter(part=>part.kind==='source'))for(const model of part.roots){
  assert.ok(tables.get(model)?.enabled&&tables.get(model)?.forced,model+': source RLS')
  for(const source of part.sources){const sourceParts=ownershipParts(source),roots=new Set(sourceParts.flatMap(part=>part.roots));if(source===part.resource)roots.delete(model);assert.ok(reaches(model,roots),model+': no canonical FK ancestry to '+source)}
 }
})
test('registered shared, office and source children remain attached to their actual roots',()=>{
 for(const part of parts.filter(part=>['shared','office','source'].includes(part.kind)))for(const child of part.children??[]){
  assert.ok(reaches(child,new Set(part.roots)),part.resource+': detached '+child)
  assert.ok(tables.get(child)?.enabled&&tables.get(child)?.forced,child+': missing inherited RLS')
 }
})
