/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {correspondenceSchema,emptyCorrespondence}=require('../platform/participants/information.ts')
const {defaultParticipantDefinition,missingParticipantInformation,participantFormDefinitionSchema,participantConfirmationProof,genericParticipantPreset}=require('../platform/participants/requirements.ts')
const {participantInformationSchema}=require('../platform/participants/validation.ts')
const {withParticipantInformation,pruneParticipantInformation}=require('../platform/participants/source-information.ts')
const {crmContactSchema}=require('../modules/crm/validation.ts')
const person={role:'CUSTOMER',party:{kind:'PERSON',id:'person-a',name:'Customer A',email:'existing@example.test',phone:null,sourceVersion:1}}
const snapshot={format:1,participants:[person]}
test('correspondence normalizes identically to CRM entry/import validation',()=>{
 const values={...emptyCorrespondence,email:' UPPER@EXAMPLE.TEST ',phone:'+91 (98765) 43210',country:'India'}
 const info=correspondenceSchema.parse(values),contact=crmContactSchema.parse({name:'Customer A',...values})
 assert.equal(info.email,'upper@example.test');assert.equal(info.phone,'+919876543210');assert.equal(info.email,contact.email);assert.equal(info.phone,contact.phone)
 for(const bad of [{email:'typo'},{phone:'9876543210'},{country:'Not a country'},{addressLine1:'x'.repeat(201)}])assert.equal(correspondenceSchema.safeParse({...emptyCorrespondence,...bad}).success,false)
})
test('draft details may be empty; optional policy never invents historical participant identities',()=>{
 assert.deepEqual(correspondenceSchema.parse(emptyCorrespondence),emptyCorrespondence)
 assert.deepEqual(missingParticipantInformation(undefined,defaultParticipantDefinition()),[])
 assert.deepEqual(participantConfirmationProof(undefined,{version:0,definition:defaultParticipantDefinition(),preset:genericParticipantPreset}).proof.configurationVersion,0)
})
test('requirements use role-specific saved details and precise configured labels',()=>{
 const definition=defaultParticipantDefinition();definition.labels.city='Town';definition.required.CUSTOMER=['email','city'];definition.required.ADDITIONAL_CUSTOMER=['phone']
 const extra={role:'ADDITIONAL_CUSTOMER',party:{...person.party,id:'person-b',name:'Customer B'}}
 assert.deepEqual(missingParticipantInformation({format:1,participants:[person,extra]},definition).map(x=>[x.participant,x.label]),[['Customer A','Town'],['Customer B','Phone']])
 const accepted={...snapshot,participants:[{...person,information:{...emptyCorrespondence,email:'accepted@example.test',city:'Pune'}}]}
 assert.equal(missingParticipantInformation(accepted,definition).length,0)
 const cleared={...snapshot,participants:[{...person,information:{...emptyCorrespondence,city:'Pune'}}]}
 assert.equal(missingParticipantInformation(cleared,definition)[0].field,'email')
})
test('invalid historical communication values cannot satisfy required details',()=>{
 const d=defaultParticipantDefinition();d.required.CUSTOMER=['email','phone']
 const bad={format:1,participants:[{...person,party:{...person.party,email:'typo',phone:'123'}}]}
 assert.deepEqual(missingParticipantInformation(bad,d).map(x=>x.field),['email','phone'])
 assert.equal(missingParticipantInformation(undefined,d)[0].field,'participants')
})
test('configuration permits bounded captions/fields, rejecting expressions, mandatory identity fields and duplicate choices',()=>{
 const d=defaultParticipantDefinition()
 for(const value of [{...d,expression:'true'},{...d,labels:{...d.labels,PAN:'Tax ID'}},{...d,required:{...d.required,CUSTOMER:['name']}},{...d,required:{...d.required,CUSTOMER:['email','email']}},{...d,title:'x'.repeat(61)}])assert.equal(participantFormDefinitionSchema.safeParse(value).success,false)
 assert.equal(participantFormDefinitionSchema.safeParse(d).success,true)
})
test('typed information is distinct from identity evidence, sharing and ownership data',()=>{
 const row={party:{kind:'PERSON',id:'person-a'},values:{...emptyCorrespondence,email:'transaction@example.test'}}
 const input={format:1,records:[row]}
 for(const bad of [{...row,name:'Injected'},{...row,values:{...row.values,ownershipShare:50}},{...row,party:{...row.party,tenantId:'foreign'}}])assert.equal(participantInformationSchema.safeParse({format:1,records:[bad]}).success,false)
 assert.equal(participantInformationSchema.safeParse({format:1,records:[row,row]}).success,false)
 const accepted=withParticipantInformation(snapshot,input)
 assert.equal(accepted.participants[0].party.email,'existing@example.test');assert.equal(accepted.participants[0].information.email,'transaction@example.test')
 row.values.email='changed@example.test';assert.equal(accepted.participants[0].information.email,'transaction@example.test')
 assert.equal('information' in snapshot.participants[0],false)
})
test('pruning removes details only for removed identities, preserving a party in another role',()=>{
 const input={format:1,records:[{party:{kind:'PERSON',id:'person-a'},values:emptyCorrespondence},{party:{kind:'PERSON',id:'removed'},values:emptyCorrespondence}]}
 assert.deepEqual(pruneParticipantInformation(input,snapshot).records.map(x=>x.party.id),['person-a'])
 assert.equal(pruneParticipantInformation(null,snapshot),undefined)
})
