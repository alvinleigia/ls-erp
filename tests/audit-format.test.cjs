/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {auditChanges,redactAudit}=require('../platform/audit/format.ts')
test('partial updates show changed values without claiming omitted fields were deleted',()=>{
 assert.deepEqual(auditChanges({name:'A',status:'DRAFT',version:1,notes:'preserved'},{name:'A',status:'OPEN',version:2}),[{field:'status',before:'DRAFT',after:'OPEN'}])
 assert.deepEqual(auditChanges({settings:{currency:'INR',locale:'en-IN'}},{settings:{currency:'USD'}}),[{field:'settings.currency',before:'INR',after:'USD'}])
 assert.deepEqual(auditChanges({name:'A'},{name:null}),[{field:'name',before:'A',after:null}])
})
test('creation/deletion and arrays have readable changes and ignore bookkeeping',()=>{
 assert.deepEqual(auditChanges(null,{id:'new',name:'A'}),[{field:'name',before:null,after:'A'}])
 assert.deepEqual(auditChanges({id:'old',name:'A'},null),[{field:'name',before:'A',after:null}])
 assert.deepEqual(auditChanges({permissions:['read']},{permissions:['read','edit']}),[{field:'permissions',before:['read'],after:['read','edit']}])
})
test('credential redaction is recursive and does not mutate stored objects',()=>{
 const input={passwordHash:'hash',token:'token',nested:[{api_key:'key',licenseKey:'license',description:'keep',role:'STAFF'}],database_url:'url',authorization:'bearer'}
 const clean=redactAudit(input)
 assert.equal(input.passwordHash,'hash');assert.equal(clean.passwordHash,'[redacted]');assert.equal(clean.nested[0].api_key,'[redacted]');assert.equal(clean.nested[0].description,'keep')
 assert.equal(clean.nested[0].licenseKey,'[redacted]');assert.equal(clean.database_url,'[redacted]');assert.equal(clean.authorization,'[redacted]')
 assert.equal(JSON.stringify(clean).includes('bearer'),false)
})
