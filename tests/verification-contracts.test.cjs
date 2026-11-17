/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {verificationPolicySchema,verificationSubjectSchema,emptyVerificationPolicy,applicableRequirements}=require('../platform/verification/contracts.ts')
const {moduleEnabled,businessModules}=require('../platform/modules.ts'),{externalPermissionAllowed}=require('../platform/collaborators/permissions.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{recordScope}=require('../platform/access/rules.ts'),{composeProfilePermissions}=require('../platform/access/profiles.ts')
const fact={code:'legal_name',label:'Legal name',type:'TEXT',subjects:['PERSON'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}
const {simpleIndividualVerificationPolicy}=require('../platform/verification/starter-checklist.ts')
const {verificationQueueSchema,verificationHistorySchema,verificationRevisionSchema}=require('../platform/verification/review-contracts.ts')
const {verificationChecklists,verificationViewSchema}=require('../platform/verification/contracts.ts')

test('ordinary customer verification hides duplicate and unused role checklist choices',()=>{
 const policy=simpleIndividualVerificationPolicy()
 assert.deepEqual(verificationChecklists(policy,'PERSON').map(g=>({role:g.role,roles:g.roles})),[{role:'CUSTOMER',roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}])
 policy.facts.push({code:'authority',label:'Authority reference',type:'TEXT',subjects:['PERSON'],roles:['REPRESENTATIVE']})
 assert.deepEqual(verificationChecklists(policy,'PERSON').map(g=>g.role),['CUSTOMER','REPRESENTATIVE'])
 assert.deepEqual(verificationChecklists(policy,'BUSINESS').map(g=>g.role),['CUSTOMER'])
 assert.equal(verificationViewSchema.safeParse({kind:'PERSON',id:'person',role:'ADDITIONAL_CUSTOMER'}).success,true)
 assert.equal(verificationViewSchema.safeParse({kind:'PERSON',id:'person',role:'ADMIN'}).success,false)
 assert.equal(verificationViewSchema.safeParse({kind:'PERSON',id:'person',tenantId:'other'}).success,false)
})

test('review/history queries use bounded strict contracts and cannot override customer or tenant scope',()=>{
 assert.deepEqual(verificationQueueSchema.parse({}),{page:1,pageSize:10,search:''})
 assert.equal(verificationQueueSchema.parse({page:'2',pageSize:'5',search:' buyer '}).search,'buyer')
 for(const input of [{page:0},{pageSize:100},{page:'invalid'},{role:'ADMIN'},{kind:'PROJECT'},{search:'x'.repeat(101)},{tenantId:'foreign'}])assert.equal(verificationQueueSchema.safeParse(input).success,false)
 assert.equal(verificationHistorySchema.parse({kind:'PERSON',id:'customer_1',page:'2'}).page,2)
 assert.equal(verificationHistorySchema.safeParse({kind:'PERSON',id:'customer_1',pageSize:1000}).success,false)
 assert.equal(verificationRevisionSchema.safeParse({kind:'PERSON',id:'customer_1',submissionId:'revision_1'}).success,true)
 assert.equal(verificationRevisionSchema.safeParse({kind:'PERSON',id:'customer_1',submissionId:'revision_1',canReview:true}).success,false)
})

test('simple checklist is an independent opt-in draft with two categories for each individual applicant only',()=>{
 const policy=verificationPolicySchema.parse(simpleIndividualVerificationPolicy())
 assert.deepEqual(policy.facts,[]);assert.equal(policy.validityDays,null);assert.equal(policy.preventSelfApproval,true)
 assert.deepEqual(policy.documents.map(d=>d.code),['tax_identification','identity_address'])
 for(const role of ['CUSTOMER','ADDITIONAL_CUSTOMER'])assert.equal(applicableRequirements(policy,'PERSON',role).documents.length,2)
 assert.equal(applicableRequirements(policy,'PERSON','REPRESENTATIVE').documents.length,0)
 assert.equal(applicableRequirements(policy,'BUSINESS','CUSTOMER').documents.length,0)
 policy.documents[0].roles.pop();policy.documents[1].label='Changed draft'
 assert.equal(simpleIndividualVerificationPolicy().documents[0].roles.length,2)
 assert.equal(simpleIndividualVerificationPolicy().documents[1].label,'Identity/address evidence')
 assert.deepEqual(emptyVerificationPolicy().documents,[])
})
test('verification has no universal identity document or required fact and defaults off',()=>{
 assert.deepEqual(verificationPolicySchema.parse(emptyVerificationPolicy()),{format:1,facts:[],documents:[],validityDays:null,preventSelfApproval:true})
 assert.equal(businessModules.customerVerification.defaultEnabled,false)
 assert.equal(moduleEnabled([{key:'customerVerification',allowed:true,enabled:true}],'customerVerification'),false)
 assert.equal(moduleEnabled([{key:'customerVerification',allowed:true,enabled:true},{key:'crm',allowed:true,enabled:true}],'customerVerification'),true)
})
test('requirements distinguish person/business and primary/additional applicants',()=>{
 const policy=verificationPolicySchema.parse({...emptyVerificationPolicy(),facts:[fact],documents:[{code:'business_proof',label:'Business proof',subjects:['BUSINESS'],roles:['CUSTOMER']}]})
 assert.equal(applicableRequirements(policy,'PERSON','ADDITIONAL_CUSTOMER').facts.length,1)
 assert.equal(applicableRequirements(policy,'PERSON','REPRESENTATIVE').facts.length,0)
 assert.equal(applicableRequirements(policy,'BUSINESS','CUSTOMER').documents.length,1)
 assert.equal(applicableRequirements(policy,'PERSON','CUSTOMER').documents.length,0)
})
test('reject invalid, duplicate, unbounded, ambiguous or executable policy definitions',()=>{
 for(const patch of [{facts:[fact,fact]},{facts:[{...fact,code:'__proto__'}]},{facts:[{...fact,roles:[]}]},{facts:[{...fact,subjects:['PERSON','PERSON']}]},{facts:[{...fact,label:' '}]},{facts:[{...fact,type:'JAVASCRIPT'}]},{facts:[{...fact,script:'x'}]},{documents:Array.from({length:21},(_,i)=>({code:'d_'+i,label:'Proof',subjects:['PERSON'],roles:['CUSTOMER']}))},{validityDays:0},{validityDays:3651},{validityDays:1.5},{preventSelfApproval:false},{gate:'REQUIRED'}])assert.equal(verificationPolicySchema.safeParse({...emptyVerificationPolicy(),...patch}).success,false,JSON.stringify(patch))
})
test('canonical subjects cannot be anonymous, polymorphic free text or cross-kind payloads',()=>{
 assert.deepEqual(verificationSubjectSchema.parse({kind:'BUSINESS',id:'account_1'}),{kind:'BUSINESS',id:'account_1'})
 for(const value of [{kind:'PROJECT',id:'p'},{kind:'PERSON',id:''},{kind:'PERSON',id:'p',tenantId:'foreign'}])assert.equal(verificationSubjectSchema.safeParse(value).success,false)
})
test('new capabilities do not grant existing profiles and external logins cannot inherit KYC',()=>{
 const permissions=allPermissions.filter(p=>p.startsWith('verificationPolicies.')||p.startsWith('customerVerification.'))
 for(const p of permissions){assert.equal(externalPermissionAllowed(p),false);assert.equal(recordScope({role:'MANAGER',tenantId:'t',userId:'u',recordRules:{}},p.split('.')[0]),'NONE')}
 assert.deepEqual(composeProfilePermissions('MANAGER',[{roleId:'old',role:{archived:false,permissions:['contacts.read']}}]),['contacts.read'])
})
