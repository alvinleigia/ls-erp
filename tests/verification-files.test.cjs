/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{PDFDocument}=require('pdf-lib'),sharp=require('sharp')
const {validateEvidenceFile}=require('../platform/verification/evidence-files.ts'),{evidenceUploadSchema,EVIDENCE_LIMIT}=require('../platform/verification/evidence-contracts.ts'),{evidencePath,validEvidencePath}=require('../platform/verification/evidence-storage.ts')
test('upload contract bounds files and rejects unsafe names or unsupported MIME types',()=>{
 const row={caseId:'c',documentCode:'identity',filename:'identity proof.png',bytes:100,contentType:'image/png'}
 assert.equal(evidenceUploadSchema.safeParse(row).success,true)
 for(const patch of [{bytes:0},{bytes:EVIDENCE_LIMIT+1},{bytes:1.5},{filename:'../proof.png'},{filename:'x\n.pdf'},{filename:'"x.pdf'},{contentType:'image/svg+xml'},{documentCode:'../x'}])assert.equal(evidenceUploadSchema.safeParse({...row,...patch}).success,false)
})
test('valid originals are inspected without re-encoding; checksums match exactly',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage();const fixtures=[['application/pdf',await pdf.save()],['image/png',await sharp({create:{width:20,height:10,channels:3,background:'#ff8800'}}).png().toBuffer()],['image/jpeg',await sharp({create:{width:20,height:10,channels:3,background:'#ff8800'}}).jpeg().toBuffer()]]
 for(const [contentType,bytes]of fixtures){const before=Buffer.from(bytes),result=await validateEvidenceFile(bytes,{contentType,bytes:bytes.length});assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(Buffer.from(bytes),before)}
})
test('spoofed, corrupt, mismatched and oversized content cannot be accepted',async()=>{
 const png=await sharp({create:{width:5,height:5,channels:3,background:'white'}}).png().toBuffer()
 for(const [bytes,contentType,count]of [[png,'image/jpeg',png.length],[png,'image/png',png.length+1],[Buffer.from('%PDF-1.7\nnot a pdf\n%%EOF'),'application/pdf',27],[Buffer.from('<svg/>'),'image/png',6],[Buffer.from([137,80,78,71]),'image/png',4]])await assert.rejects(validateEvidenceFile(bytes,{contentType,bytes:count}))
 await assert.rejects(validateEvidenceFile(Buffer.alloc(EVIDENCE_LIMIT+1),{contentType:'image/png',bytes:EVIDENCE_LIMIT+1}),e=>e.status===413)
})
test('evidence object keys are tenant/case bound and cannot point into public branding or PDF archives',()=>{
 const path=evidencePath('tenant_1','case_1',randomUUID(),'image/png');assert.equal(validEvidencePath(path),path)
 for(const path of ['t/../secret','t/quotations/q/1/x.pdf','https://evil.test/file','t/cases/c/../../f.png'])assert.throws(()=>validEvidencePath(path))
})
