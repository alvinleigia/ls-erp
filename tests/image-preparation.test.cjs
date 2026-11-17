/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp')
const {imageDimensions,rotatedDimensions,cropPixels,loadCropImage,croppedImageFile,drawRotatedImage}=require('../components/uploads/image-preparation.ts')
test('JPEG and PNG dimensions are inspected before browser image decoding',async()=>{
 for(const type of ['png','jpeg']){const bytes=await sharp({create:{width:800,height:400,channels:4,background:{r:0,g:40,b:80,alpha:0.5}}})[type]().toBuffer();assert.deepEqual(imageDimensions(bytes,'image/'+type),{width:800,height:400})}
})
test('corrupt, truncated, spoofed and oversized image headers fail before decoding',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from([255,216,255]),Buffer.from([255,216,255,224,255,255]),Buffer.from('Not an image')])assert.throws(()=>imageDimensions(bytes,'image/jpeg'))
 const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(6000,16);bytes.writeUInt32BE(4000,20);assert.throws(()=>imageDimensions(bytes,'image/png'),/20 megapixels/)
 bytes.writeUInt32BE(16385,16);bytes.writeUInt32BE(1,20);assert.throws(()=>imageDimensions(bytes,'image/png'),/16,384/)
 assert.throws(()=>imageDimensions(bytes,'application/pdf'))
})
test('crop coordinates stay tied to natural pixels across responsive display sizes',()=>{
 const area={x:25,y:25,width:50,height:50};assert.deepEqual(cropPixels(area,800,400),{x:200,y:100,width:400,height:200});assert.deepEqual(cropPixels(area,4000,2000),{x:1000,y:500,width:2000,height:1000})
 assert.deepEqual(cropPixels({x:0,y:0,width:100.00000001,height:100},800,400),{x:0,y:0,width:800,height:400})
})
test('crop geometry rejects empty, out of bounds and non-finite selections',()=>{
 for(const area of [{x:-1,y:0,width:5,height:5},{x:0,y:0,width:0,height:5},{x:90,y:0,width:11,height:5},{x:0,y:100,width:5,height:1},{x:NaN,y:0,width:5,height:5},{x:0,y:0,width:Infinity,height:5}])assert.throws(()=>cropPixels(area,800,400))
})
test('quarter-turn rotations swap dimensions without resizing or losing resolution',()=>{
 for(const rotation of [0,90,180,270])assert.deepEqual(rotatedDimensions(800,400,rotation),rotation===90||rotation===270?{width:400,height:800}:{width:800,height:400})
})
test('the working preview is bounded without changing the original bitmap dimensions',()=>{
 const image={width:4000,height:3000},calls=[],context={scale:(...v)=>calls.push(v),translate(){},rotate(){},drawImage(source){assert.equal(source,image)}},canvas={width:0,height:0,getContext(){return context}}
 drawRotatedImage(canvas,image,90);assert.equal(canvas.width,1200);assert.equal(canvas.height,1600);assert.deepEqual(calls,[[0.4,0.4]]);assert.deepEqual(image,{width:4000,height:3000})
})
test('image preparation rejects unsupported, empty and over-limit local files',async()=>{
 for(const file of [new File(['bad'],'x.svg',{type:'image/svg+xml'}),new File([],'empty.png',{type:'image/png'}),new File([Buffer.alloc(1025)],'large.png',{type:'image/png'})])await assert.rejects(loadCropImage(file,1024),/JPEG or PNG/)
})
test('an unchanged full-frame crop returns the original bytes and File without encoding',async()=>{
 const file=new File(['unchanged original'],'original.jpg',{type:'image/jpeg'}),result=await croppedImageFile(file,{width:800,height:400},{x:0,y:0,width:100,height:100},0,5242880)
 assert.equal(result,file);assert.equal(await result.text(),'unchanged original')
})
