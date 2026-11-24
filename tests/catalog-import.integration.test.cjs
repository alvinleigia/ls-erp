/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),ExcelJS=require('exceljs')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{fixtureUser,fixtureRole,fixtureProfile}=require('./helpers/access-fixtures.cjs')
const {applicationCatalog}=require('../application/catalog/service.ts'),{createRealEstateService}=require('../modules/real-estate/service.ts')
const {templateColumns,basicCatalogImportProfile}=require('../modules/catalog/import-template.ts'),{propertyCatalogImportProfile}=require('../modules/real-estate/catalog-import.ts')
const {spreadsheetCsv}=require('../platform/imports/csv.ts'),{parseImportFile}=require('../platform/imports/file.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/ls_salon_crm_test')
const tenant='cat_import_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',pools=[],clients=[]
function client(t,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:3});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId:t,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),otherDb=client(foreign),fail=code=>e=>e.status===code
let admin,other,staff,catalog,property,leaf,phase,category,second
const fields=key=>templateColumns(key==='realEstate'?propertyCatalogImportProfile:basicCatalogImportProfile).map(c=>c.key)
const row=(patch={})=>({item_code:randomUUID(),item_name:'Synthetic catalog item',kind:'PRODUCT',sales_unit:'each',unit_price:'100.125',currency:'INR',availability:'AVAILABLE',description:'',...patch})
const propertyRow=(patch={})=>row({unit_code:randomUUID(),unit_number:randomUUID(),kind:'UNIT',sales_unit:'plot',project_code:leaf.code,property_category:category.name,launch_phase_code:phase.code,area:'250',area_unit:'SQ_M',bedrooms:'',...patch})
const upload=(rows,key='catalog',svc=catalog)=>svc.uploadCatalogImport(key,'template.csv',Buffer.from(spreadsheetCsv(fields(key),rows.map(r=>fields(key).map(k=>r[k]||'')))))
async function processImport(id,action='validate',svc=catalog){let p;for(let i=0;i<100;i++){p=await svc.processCatalogImport(id,action);if(p.status!==(action==='validate'?'VALIDATING':'IMPORTING'))return p}throw Error('Import did not finish')}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');other=await user(foreign,'ADMIN');staff=await user(tenant,'STAFF');const another=await user(tenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','catalog','realEstate'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 catalog=applicationCatalog(db,{tenantId:tenant,userId:admin.id});property=createRealEstateService(db,{tenantId:tenant,userId:admin.id});second=applicationCatalog(db,{tenantId:tenant,userId:another.id})
 const project=await property.createProject({name:'Import root',code:'IMPORT'});leaf=await property.createProject({name:'Deep branch',code:'DEEP',parentId:project.id})
 phase=await property.saveLaunchPhase(project.id,{name:'First launch',code:'FIRST',status:'PLANNED'});category=(await property.listChoices('property-categories',{})).items[0]
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('standard workbook has no data rows, stable headings, instructions and text codes; both profiles round-trip',async()=>{
 for(const key of ['catalog','realEstate']){
  const result=await catalog.downloadCatalogImportTemplate(key),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(result.bytes))
  const sheet=book.worksheets[0];assert.equal(sheet.name,'Items');assert.deepEqual(sheet.getRow(1).values.slice(1),fields(key));assert.equal(sheet.getCell('A2').text,'');assert.ok(book.getWorksheet('Instructions'))
  const values=key==='catalog'?row({item_code:'000045'}):propertyRow({unit_code:'PROP-001'})
  fields(key).forEach((field,i)=>sheet.getCell(2,i+1).value=values[field]||'')
  const job=await catalog.uploadCatalogImport(key,'filled.xlsx',new Uint8Array(await book.xlsx.writeBuffer()));assert.equal((await processImport(job.id)).counts.READY,1)
 }
})
test('wrong template headers, empty, over-limit files and formula cells are rejected without creating catalog records',async()=>{
 await assert.rejects(catalog.uploadCatalogImport('catalog','wrong.csv',Buffer.from('code,name\na,b\n')),fail(400))
 await assert.rejects(catalog.uploadCatalogImport('catalog','empty.csv',Buffer.alloc(0)),fail(400))
 await assert.rejects(parseImportFile('large.csv',Buffer.alloc(3*1024*1024+1)),fail(400))
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Items');sheet.addRow(fields('catalog'));sheet.addRow(fields('catalog').map(k=>row()[k]));sheet.getCell('E2').value={formula:'10+20',result:30}
 const job=await catalog.uploadCatalogImport('catalog','formula.xlsx',new Uint8Array(await book.xlsx.writeBuffer())),done=await processImport(job.id);assert.equal(done.counts.INVALID,1)
})

test('standard charge columns import reviewed defaults and reject incomplete or invalid charge rows',async()=>{
 const good=row({charge_name:'PLC',charge_calculation:'PERCENT',charge_value:'8',charge_treatment:'INCLUDED'}),job=await upload([good,row({charge_name:'PLC'}),row({charge_name:'PLC',charge_calculation:'PERCENT',charge_value:'108',charge_treatment:'EXTRA'}),row({charge_value:'8'})])
 const ready=await processImport(job.id);assert.equal(ready.counts.READY,1);assert.equal(ready.counts.INVALID,3)
 assert.equal((await processImport(job.id,'import')).counts.IMPORTED,1)
 const item=await root.catalogItem.findUniqueOrThrow({where:{tenantId_code:{tenantId:tenant,code:good.item_code.toUpperCase()}}});assert.deepEqual(item.charges,[{label:'PLC',kind:'PERCENT',value:'8',included:true,due:'',group:''}])
})

test('earlier import history and correction downloads remain readable without reprocessing old rows',async()=>{
 const headers=fields('catalog').slice(0,-5),job=await root.catalogImport.create({data:{tenantId:tenant,createdByUserId:admin.id,profile:'catalog',templateVersion:1,fileName:'old-template.csv',headers,status:'REVIEW'}})
 await root.catalogImportRow.create({data:{tenantId:tenant,importId:job.id,rowNumber:2,values:headers.map(k=>row()[k]||''),status:'INVALID',errors:[{field:'unit_price',message:'Correct price'}]}})
 assert.equal((await catalog.getCatalogImport(job.id)).templateVersion,1)
 assert.match(await catalog.catalogImportCorrections(job.id),/Correct price/)
 await assert.rejects(catalog.processCatalogImport(job.id,'validate'),fail(409));await assert.rejects(catalog.processCatalogImport(job.id,'import'),fail(409))
 assert.equal((await catalog.getCatalogImport(job.id)).counts.INVALID,1)
})
test('validation creates no inventory; errors and case-insensitive duplicates produce a reuploadable correction file',async()=>{
 const code=randomUUID(),good=row({item_code:code}),job=await upload([good,row({item_code:code.toUpperCase()}),row({unit_price:'-1'}),row({availability:''}),row({unit_price:'1,000'}),row({kind:'PRODUCT',availability:'SOLD'})])
 const before=await root.catalogItem.count({where:{tenantId:tenant}}),validated=await processImport(job.id)
 assert.equal(await root.catalogItem.count({where:{tenantId:tenant}}),before);assert.equal(validated.counts.READY,1);assert.equal(validated.counts.DUPLICATE,1);assert.equal(validated.counts.INVALID,4)
 const finished=await processImport(job.id,'import');assert.equal(finished.counts.IMPORTED,1)
 const csv=await catalog.catalogImportCorrections(job.id),sheet=await parseImportFile('corrections.csv',Buffer.from(csv));assert.equal(sheet.rows.length,5);assert.ok(!sheet.rows.some(r=>r.values[0]===code))
 const retry=await catalog.uploadCatalogImport('catalog','corrections.csv',Buffer.from(csv));assert.ok(retry.id)
 const again=await upload([good]);assert.equal((await processImport(again.id)).counts.DUPLICATE,1)
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,event:'catalog.item.created',entityId:(await root.catalogItem.findUnique({where:{tenantId_code:{tenantId:tenant,code:code.toUpperCase()}}})).id}}),1)
})
test('property import validates root-owned phases and native scope; imported units retain planned-launch gating',async()=>{
 const otherRoot=await property.createProject({name:'Another root',code:'ANOTHER'});await property.saveLaunchPhase(otherRoot.id,{name:'Foreign phase',code:'WRONG',status:'OPEN'})
 const good=propertyRow(),job=await upload([good,propertyRow({launch_phase_code:'WRONG'}),propertyRow({project_code:'UNKNOWN'}),propertyRow({property_category:'Typo'}),propertyRow({area:'250',area_unit:''}),propertyRow({bedrooms:'1.5'}),propertyRow({kind:'PRODUCT'})],'realEstate')
 const validated=await processImport(job.id);assert.equal(validated.counts.READY,1);assert.equal(validated.counts.INVALID,6)
 assert.equal((await processImport(job.id,'import')).counts.IMPORTED,1)
 const unit=await root.realEstateUnit.findFirstOrThrow({where:{tenantId:tenant,companyCode:good.unit_code}}),item=await root.catalogItem.findUniqueOrThrow({where:{tenantId_id:{tenantId:tenant,id:unit.itemId}}}),detail=await catalog.get(item.id)
 assert.equal(detail.extension.projectId,leaf.id);assert.equal(detail.extension.launchPhaseId,phase.id);assert.match(detail.reservationBlockedReason,/not open/)
 assert.equal(await root.unitReservation.count({where:{tenantId:tenant,itemId:item.id}}),0)
})

test('property imports generate references and names, preserve company codes and reject duplicates within a section',async()=>{
 const another=await property.createProject({name:'Second building',code:'IMPORT-SECOND',parentId:leaf.parentId})
 const base=propertyRow({unit_code:'aqua_01',item_name:'',unit_number:'0001',floor:'Ground'}),job=await upload([base,{...base,unit_number:'0002'},{...base,unit_code:'other-code'},{...base,project_code:another.code},{...base,unit_number:'',unit_code:'missing-number'}],'realEstate')
 const ready=await processImport(job.id);assert.equal(ready.counts.READY,2);assert.equal(ready.counts.DUPLICATE,2);assert.equal(ready.counts.INVALID,1)
 assert.equal((await processImport(job.id,'import')).counts.IMPORTED,2)
 const saved=await root.realEstateUnit.findMany({where:{tenantId:tenant,companyCode:'aqua_01'},include:{item:true}});assert.equal(saved.length,2)
 for(const unit of saved){assert.equal(unit.unitNumber,'0001');assert.equal(unit.floor,'Ground');assert.match(unit.item.code,/^ITM-/);assert.ok(unit.item.name.endsWith('0001'))}
 const retry=await upload([base],'realEstate');assert.equal((await processImport(retry.id)).counts.DUPLICATE,1)
 for(const templateVersion of [1,2]){const old=await root.catalogImport.create({data:{tenantId:tenant,createdByUserId:admin.id,profile:'realEstate',templateVersion,fileName:'older.csv',headers:fields('realEstate'),status:'REVIEW'}});assert.equal((await catalog.getCatalogImport(old.id)).templateVersion,templateVersion);await assert.rejects(catalog.processCatalogImport(old.id,'import'),fail(409))}
})

test('unit-code headings and validation use the current terminology while earlier saved headers remain read-only',async()=>{
 const headers=fields('realEstate');assert.ok(headers.includes('unit_code'));assert.ok(!headers.includes('company_code'))
 const bad=await upload([propertyRow({unit_code:'x'.repeat(101)})],'realEstate');assert.equal((await processImport(bad.id)).counts.INVALID,1)
 const current=await catalog.getCatalogImport(bad.id);assert.equal(current.canProcess,true);assert.equal(current.items[0].errors[0].field,'unit_code')
 const previous=headers.map(k=>k==='unit_code'?'company_code':k),job=await root.catalogImport.create({data:{tenantId:tenant,createdByUserId:admin.id,profile:'realEstate',templateVersion:3,fileName:'earlier-local-template.csv',headers:previous,status:'REVIEW'}})
 const saved=await catalog.getCatalogImport(job.id);assert.equal(saved.canProcess,false);assert.deepEqual(saved.headers,previous)
 await assert.rejects(catalog.processCatalogImport(job.id,'import'),fail(400))
 assert.deepEqual((await catalog.getCatalogImport(job.id)).headers,previous)
 await assert.rejects(catalog.uploadCatalogImport('realEstate','earlier.csv',Buffer.from(spreadsheetCsv(previous,[previous.map(()=> 'test')]))),fail(400))
})
test('tenant and creator isolation, current permissions and module revocation are enforced on every operation',async()=>{
 const job=await upload([row()]),foreignCatalog=applicationCatalog(otherDb,{tenantId:foreign,userId:other.id}),staffCatalog=applicationCatalog(db,{tenantId:tenant,userId:staff.id})
 for(const svc of [second,foreignCatalog]){await assert.rejects(svc.getCatalogImport(job.id),fail(404));await assert.rejects(svc.processCatalogImport(job.id,'import'),fail(404));await assert.rejects(svc.catalogImportCorrections(job.id),fail(404))}
 await assert.rejects(staffCatalog.uploadCatalogImport('catalog','test.csv',Buffer.from('a\nb')),fail(403))
 assert.equal((await runWithDatabaseActor(staff.id,()=>db.catalogImport.findMany({where:{id:job.id}}))).length,0)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'catalog'}},data:{enabled:false}})
 try{await assert.rejects(catalog.processCatalogImport(job.id,'validate'),fail(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'catalog'}},data:{enabled:true}})}
 const user=await fixtureUser(root,{data:{tenantId:tenant,role:'MANAGER',name:'Importer',email:randomUUID()+'@example.test'}}),role=await fixtureProfile(root,{data:{tenantId:tenant,name:'Catalog importer',nameKey:randomUUID(),permissions:['catalogItems.read','catalogItems.create']}});await fixtureRole(root,{data:{tenantId:tenant,userId:user.id,roleId:role.id}})
 const scoped=applicationCatalog(db,{tenantId:tenant,userId:user.id});assert.deepEqual((await scoped.catalogImportOptions()).items.map(p=>p.key),['catalog']);await assert.rejects(scoped.downloadCatalogImportTemplate('realEstate'),fail(403))
})
test('changed setup bindings and late duplicates are rechecked; completed rows and source files remain immutable',async()=>{
 const item=row(),job=await upload([item]);await processImport(job.id)
 await catalog.save({code:item.item_code,name:'Created meanwhile',kind:'PRODUCT',price:'5',currency:'INR'})
 assert.equal((await processImport(job.id,'import')).counts.DUPLICATE,1)
 const good=propertyRow(),prop=await upload([good],'realEstate');await processImport(prop.id)
 const previous=await root.realEstateProject.findUnique({where:{tenantId_id:{tenantId:tenant,id:leaf.id}}});await property.updateProject(leaf.id,{name:leaf.name,code:'RENAMED',parentId:leaf.parentId,version:previous.version})
 const replacement=await property.createProject({name:'Replacement node',code:leaf.code,parentId:leaf.parentId})
 try{assert.equal((await processImport(prop.id,'import')).counts.INVALID,1);assert.match(JSON.stringify((await catalog.getCatalogImport(prop.id)).items[0].errors),/changed after validation/)}finally{await property.updateProject(replacement.id,{name:replacement.name,code:'REPLACEMENT',parentId:replacement.parentId,version:replacement.version});const latest=await root.realEstateProject.findUnique({where:{tenantId_id:{tenantId:tenant,id:leaf.id}}});await property.updateProject(leaf.id,{name:leaf.name,code:leaf.code,parentId:leaf.parentId,version:latest.version})}
 const completed=await upload([row()]);await processImport(completed.id);await processImport(completed.id,'import')
 await assert.rejects(root.catalogImport.update({where:{id:completed.id},data:{profile:'realEstate'}}),/immutable/)
 const record=(await root.catalogImportRow.findMany({where:{importId:completed.id}}))[0];await assert.rejects(root.catalogImportRow.update({where:{tenantId_importId_rowNumber:{tenantId:tenant,importId:completed.id,rowNumber:record.rowNumber}},data:{status:'READY',itemId:null}}),/immutable/)
})
test('concurrent and resumed batches import 1000 rows exactly once with compact progress and paged details',async()=>{
 const rows=Array.from({length:1000},(_,i)=>row({item_code:'BULK-'+i})),job=await upload(rows)
 const start=Date.now(),first=await catalog.processCatalogImport(job.id,'validate');assert.equal(first.counts.READY,25);assert.ok(JSON.stringify(first).length<300)
 await processImport(job.id)
 const pair=await Promise.all([catalog.processCatalogImport(job.id,'import'),catalog.processCatalogImport(job.id,'import')]);assert.equal(Math.max(...pair.map(p=>p.counts.IMPORTED)),50)
 const finished=await processImport(job.id,'import');assert.equal(finished.counts.IMPORTED,1000);assert.equal(finished.status,'COMPLETE')
 assert.deepEqual(await catalog.processCatalogImport(job.id,'import'),finished)
 assert.equal((await catalog.getCatalogImport(job.id,{page:2,pageSize:20})).items.length,20)
 assert.equal(await root.catalogItem.count({where:{tenantId:tenant,code:{startsWith:'BULK-'}}}),1000)
 console.log(`1000-row catalog validate + import: ${Date.now()-start} ms in bounded batches; 1000 unique audited items.`)
})
test('blank prices stay unset and blank currency uses one immutable upload-time business default',async()=>{
 await root.appSetting.upsert({where:{tenantId:tenant},create:{tenantId:tenant,currency:'INR'},update:{currency:'INR'}})
 const unset=row({unit_price:'',currency:''}),free=row({unit_price:'0',currency:''}),override=row({currency:'EUR'}),bad=row({currency:'NOT-CURRENCY'})
 const job=await upload([unset,free,override,bad]);assert.equal((await catalog.getCatalogImport(job.id)).defaultCurrency,'INR')
 await assert.rejects(root.catalogImport.update({where:{id:job.id},data:{defaultCurrency:'USD'}}),/immutable/)
 await root.appSetting.update({where:{tenantId:tenant},data:{currency:'USD'}})
 const earlier=await root.catalogImport.create({data:{tenantId:tenant,createdByUserId:admin.id,profile:'catalog',templateVersion:3,fileName:'older-currency.csv',headers:fields('catalog')}})
 await root.catalogImportRow.create({data:{tenantId:tenant,importId:earlier.id,rowNumber:2,values:fields('catalog').map(key=>unset[key]||'')}})
 assert.equal((await processImport(earlier.id)).counts.INVALID,1);assert.match(JSON.stringify((await catalog.getCatalogImport(earlier.id)).items[0].errors),/Re-upload this row/)
 const validated=await processImport(job.id);assert.equal(validated.counts.READY,3);assert.equal(validated.counts.INVALID,1)
 assert.equal((await processImport(job.id,'import')).counts.IMPORTED,3)
 const get=code=>root.catalogItem.findUniqueOrThrow({where:{tenantId_code:{tenantId:tenant,code:code.toUpperCase()}}})
 assert.equal((await get(unset.item_code)).price,null);assert.equal((await get(unset.item_code)).currency,'INR')
 assert.equal(String((await get(free.item_code)).price),'0');assert.equal((await get(free.item_code)).currency,'INR');assert.equal((await get(override.item_code)).currency,'EUR')
 const original=(await catalog.getCatalogImport(job.id)).items[0].values;assert.equal(original[fields('catalog').indexOf('currency')],'');assert.equal(original[fields('catalog').indexOf('unit_price')],'')
 const propertyJob=await upload([propertyRow({unit_price:'',currency:''})],'realEstate');assert.equal((await processImport(propertyJob.id)).counts.READY,1);assert.equal((await processImport(propertyJob.id,'import')).counts.IMPORTED,1)
 const propertyItem=await root.catalogItem.findFirstOrThrow({where:{tenantId:tenant,importRows:{some:{importId:propertyJob.id}}}});assert.equal(propertyItem.price,null);assert.equal(propertyItem.currency,'USD')
 await root.appSetting.delete({where:{tenantId:tenant}})
 await assert.rejects(upload([row({currency:''})]),fail(503));assert.equal((await processImport((await upload([row({currency:'INR'})])).id)).counts.READY,1)
})

test('unexpected audit failure rolls back item creation and progress, allowing a clean retry',async()=>{
 const job=await upload([row()]);await processImport(job.id)
 const broken={$transaction:(operation,options)=>db.$transaction(tx=>operation(new Proxy(tx,{get(target,key){if(key==='auditLog')return {createMany:async()=>{throw Error('audit unavailable')}};return target[key]}})),options)}
 const svc=applicationCatalog(broken,{tenantId:tenant,userId:admin.id}),before=await root.catalogItem.count({where:{tenantId:tenant}})
 await assert.rejects(svc.processCatalogImport(job.id,'import'),/audit unavailable/)
 assert.equal(await root.catalogItem.count({where:{tenantId:tenant}}),before);assert.equal((await catalog.getCatalogImport(job.id)).counts.READY,1)
 assert.equal((await processImport(job.id,'import')).counts.IMPORTED,1)
})
