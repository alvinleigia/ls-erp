/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {verificationPolicySchema,verificationSubjectSchema,emptyVerificationPolicy,applicableRequirements}=require('../platform/verification/contracts.ts')
const {moduleEnabled,businessModules}=require('../platform/modules.ts'),{externalPermissionAllowed}=require('../platform/collaborators/permissions.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{recordScope}=require('../platform/access/rules.ts'),{composeProfilePermissions}=require('../platform/access/profiles.ts')
const fact={code:'legal_name',label:'Legal name',type:'TEXT',subjects:['PERSON'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}
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
