/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { businessNavigation } = require('../application/navigation.ts')
const { moduleEnabled, moduleChangeProblem } = require('../platform/modules.ts')
const flags = keys => keys.map(key => ({ key, allowed: true, enabled: true }))

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
