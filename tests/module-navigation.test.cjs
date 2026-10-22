/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { businessNavigation, catalogNavigation } = require('../application/navigation.ts')
const { moduleEnabled, moduleChangeProblem } = require('../platform/modules.ts')
const flags = keys => keys.map(key => ({ key, allowed: true, enabled: true }))

test('Sales Orders navigation requires activation, dependencies and read access', () => {
 const active = flags(['crm', 'salesDocuments', 'salesOrders'])
 assert.deepEqual(businessNavigation(active, ['salesOrders.read']).map(group => group.key), ['salesOrders'])
 assert.deepEqual(businessNavigation(active, ['quotations.read']).filter(group => group.key === 'salesOrders'), [])
 assert.equal(moduleEnabled(active.filter(flag => flag.key !== 'salesDocuments'), 'salesOrders'), false)
 assert.match(moduleChangeProblem(active, 'salesDocuments', false), /Sales Orders/)
 const { applicationRouteAccess } = require('../application/access-routes.ts')
 assert.equal(applicationRouteAccess.linkRequirement('/sales-orders/example'), 'salesOrders.read')
})
test('catalog navigation is independent of CRM and respects activation and read access', () => {
 assert.deepEqual(catalogNavigation(flags(['catalog']), ['catalogItems.read']).map(group=>group.key), ['catalog'])
 assert.deepEqual(catalogNavigation(flags(['catalog']), []), [])
 assert.deepEqual(catalogNavigation([]), [])
 assert.deepEqual(catalogNavigation([{key:'catalog',allowed:false,enabled:true}]), [])
})
test('receivables overview requires both reads and activation and activates only its own menu item',()=>{
 const active=flags(['crm','salesDocuments','salesOrders','receivables']),permissions=['salesOrders.read','receivables.read']
 const group=businessNavigation(active,permissions).find(g=>g.key==='salesOrders')
 assert.equal(group.items.length,2);assert.equal(group.items[0].isActive('/sales-orders/receivables'),false);assert.equal(group.items[1].isActive('/sales-orders/receivables'),true)
 assert.equal(businessNavigation(active,['salesOrders.read']).find(g=>g.key==='salesOrders').items.length,1)
 assert.equal(businessNavigation(active,['receivables.read']).length,0)
 assert.equal(businessNavigation(active.filter(f=>f.key!=='receivables'),permissions).find(g=>g.key==='salesOrders').items.length,1)
 const {applicationRouteAccess}=require('../application/access-routes.ts')
 assert.equal(applicationRouteAccess.routeResource('/sales-orders/receivables'),'receivables')
 assert.deepEqual(applicationRouteAccess.linkRequirement('/sales-orders/receivables'),permissions)
})

test('missing or revoked platform allowance hides modules even when activation is stale', () => {
 assert.equal(moduleEnabled([{key:'crm',enabled:true}], 'crm'), false)
 assert.deepEqual(businessNavigation([{key:'crm',allowed:false,enabled:true}]), [])
 assert.equal(moduleEnabled([...flags(['crm']), {key:'salesDocuments',allowed:false,enabled:true}, ...flags(['paymentPlans'])], 'paymentPlans'), false)
})

test('shared navigation groups do not require optional modules', () => {
 assert.deepEqual(businessNavigation(flags(['crm'])).map(group => group.key), ['crm','contacts','activities'])
 assert.deepEqual(businessNavigation(flags(['salesDocuments','paymentPlans','realEstate'])), [])
 assert.equal(moduleEnabled(flags(['crm','paymentPlans']), 'paymentPlans'), false)
 assert.equal(moduleChangeProblem([...flags(['crm']), {key:'salesDocuments',allowed:true,enabled:false}], 'salesDocuments', true), null)
 assert.match(moduleChangeProblem([...flags(['crm']), {key:'paymentPlans',allowed:true,enabled:false}], 'paymentPlans', true), /Sales Documents/)
})

test('each current and legacy destination activates exactly its owning section', () => {
 const groups=businessNavigation(flags(['crm','salesDocuments','paymentPlans','realEstate']))
 for (const [route, owner] of [['/crm/opportunities/deal','crm'],['/crm/contacts/person','contacts'],['/crm/tasks/task','activities'],['/crm/activity-types/type','activities'],['/crm/quotations/quote','salesDocuments'],['/crm/configuration/quotation-templates/template','salesDocuments'],['/crm/configuration/real-estate/projectStatuses','realEstate'],['/crm/projects/project','realEstate'],['/crm/configuration','crm']]) {
   assert.deepEqual(groups.filter(group=>group.isActive(route)).map(group=>group.key),[owner],route)
 }
 const links=groups.flatMap(group=>group.items.map(item=>item.href))
 assert.equal(new Set(links).size,links.length)
})
