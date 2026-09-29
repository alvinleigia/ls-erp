/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { businessNavigation } = require('../application/navigation.ts')
const { moduleEnabled, moduleChangeProblem } = require('../platform/modules.ts')
const flags = keys => keys.map(key => ({ key, enabled: true }))

test('shared navigation groups do not require optional modules', () => {
 assert.deepEqual(businessNavigation(flags(['crm'])).map(group => group.key), ['crm','contacts','activities'])
 assert.deepEqual(businessNavigation(flags(['salesDocuments','paymentPlans','realEstate'])), [])
 assert.equal(moduleEnabled(flags(['crm','paymentPlans']), 'paymentPlans'), false)
 assert.equal(moduleChangeProblem(flags(['crm']), 'salesDocuments', true), null)
 assert.match(moduleChangeProblem(flags(['crm']), 'paymentPlans', true), /Sales Documents/)
})

test('each current and legacy destination activates exactly its owning section', () => {
 const groups=businessNavigation(flags(['crm','salesDocuments','paymentPlans','realEstate']))
 for (const [route, owner] of [['/crm/opportunities/deal','crm'],['/crm/contacts/person','contacts'],['/crm/tasks/task','activities'],['/crm/activity-types/type','activities'],['/crm/quotations/quote','salesDocuments'],['/crm/configuration/quotation-templates/template','salesDocuments'],['/crm/configuration/real-estate/projectStatuses','realEstate'],['/crm/projects/project','realEstate'],['/crm/configuration','crm']]) {
   assert.deepEqual(groups.filter(group=>group.isActive(route)).map(group=>group.key),[owner],route)
 }
 const links=groups.flatMap(group=>group.items.map(item=>item.href))
 assert.equal(new Set(links).size,links.length)
})
