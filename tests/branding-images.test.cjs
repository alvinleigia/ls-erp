/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp')
const {optimizeLogo}=require('../platform/branding/images.ts')
const {brandingForm}=require('../platform/branding/request.ts')
test('logo variants preserve transparency, aspect ratio and print resolution within 512 KB',async()=>{
 const input=await sharp({create:{width:2400,height:800,channels:4,background:{r:10,g:80,b:130,alpha:.4}}}).png().withMetadata().toBuffer()
 const result=await optimizeLogo(input)
 assert.equal(result.document.info.width,1200);assert.equal(result.document.info.height,400)
 assert.equal(result.sidebar.info.width,300);assert.equal(result.sidebar.info.height,100)
 for(const image of [result.document,result.sidebar]){assert.ok(image.data.length<=512*1024);const m=await sharp(image.data).metadata();assert.equal(m.hasAlpha,true);assert.equal(m.exif,undefined)}
 assert.equal(result.warning,null)
})
test('small originals are not enlarged; JPEG and WebP are decoded into PDF-compatible PNG',async()=>{
 for(const format of ['jpeg','webp']){
 const input=await sharp({create:{width:120,height:80,channels:3,background:'blue'}})[format]().toBuffer(),r=await optimizeLogo(input)
 assert.equal(r.document.info.width,120);assert.equal(r.document.info.height,80);assert.ok(r.warning);assert.equal((await sharp(r.document.data).metadata()).format,'png')
 }
})
test('reject excessive bytes, corrupt files, vector uploads and decompression bombs',async()=>{
 for(const input of [Buffer.alloc(0),Buffer.alloc(2*1024*1024+1),Buffer.from('not an image'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer()])await assert.rejects(optimizeLogo(input),e=>e.status===400)
})
test('upload form rejects cross-origin requests and oversized streamed bodies',async()=>{
 await assert.rejects(brandingForm(new Request('https://a.example/api/settings/branding',{method:'POST',headers:{origin:'https://b.example'},body:'x'})),e=>e.status===403)
 await assert.rejects(brandingForm(new Request('https://a.example/api/settings/branding',{method:'POST',body:Buffer.alloc(2*1024*1024+16385)})),e=>e.status===413)
})
test('same-origin tenant uploads work behind the application proxy',async()=>{
 const body=new FormData();body.set('name','Proxy test');body.set('version','1')
 const result=await brandingForm(new Request('http://127.0.0.1:3108/api/settings/branding',{method:'PATCH',headers:{origin:'http://tenant.localhost:3108','x-forwarded-host':'tenant.localhost:3108','x-forwarded-proto':'http'},body}))
 assert.equal(result.input.name,'Proxy test')
})
