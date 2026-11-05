import { PDFDocument, PDFName, PDFString, PDFOperator, PDFOperatorNames, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { downloadDocumentLogo } from "../branding/storage"
import { BusinessError } from "../policy"
import type { DocumentPayload } from "./contracts"
import type { PrintableDocument } from "./contracts"
import QRCode from "qrcode"
import type { DocumentFlow } from "./layout"
import { documentLinkSchema } from "./layout"
import { defaultDocumentAppearance, documentAppearanceSchema } from "./appearance"
import type { DocumentVariant } from "./letterhead"
import { brandingLayer, letterheadPdf, markLetterheadPdf } from "./letterhead-pdf"

// A fixed, bounded font set is shared by warm requests; PDF font objects remain per document.
const fontFiles = new Map<string, Promise<Buffer>>()
function fontBytes(name: string) {
  let bytes = fontFiles.get(name)
  if (!bytes) { bytes = readFile(path.join(process.cwd(), `public/assets/fonts/NotoSans-${name}.ttf`)); fontFiles.set(name, bytes); bytes.catch(() => fontFiles.delete(name)) }
  return bytes
}

// Registered providers supply plain text and tables. No HTML, expressions,
// arbitrary image URLs or industry-specific fields enter this renderer.
export async function renderBusinessDocument(document: PrintableDocument, preview = false, variant: DocumentVariant = "digital") {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  const style = document.appearance ? documentAppearanceSchema.parse(document.appearance) : defaultDocumentAppearance
  const profile = style.letterhead
  if (variant === "letterhead" && !profile) throw new BusinessError(409, "Enable letterhead printing in the issuing company's document settings first.")
  if (profile) markLetterheadPdf(pdf)
  const font = await pdf.embedFont(await fontBytes("Regular"), { subset: true })
  const variants: Record<string,PDFFont> = { regular:font }
  const requiredFonts = new Set<string>()
  for (const node of document.body ?? []) if ("runs" in node) for (const run of node.runs) {
    const bold = run.bold || node.type === "heading"
    if (bold || run.italic) requiredFonts.add(bold ? run.italic ? "BoldItalic" : "Bold" : "Italic")
  }
  for (const name of requiredFonts) variants[name] = await pdf.embedFont(await fontBytes(name), { subset: true })
  const supported = new Set(font.getCharacterSet()), ink = style.colour === "black" ? rgb(.08,.08,.08) : style.colour === "teal" ? rgb(.04,.28,.3) : rgb(.1,.15,.2), muted = style.colour === "black" ? rgb(.3,.3,.3) : rgb(.36,.4,.44), pale = style.colour === "black" ? rgb(.95,.95,.95) : rgb(.94,.96,.97)
  const margin = { standard: 42, narrow: 32, wide: 54 }[style.margins], width = 595 - margin * 2, pageTop = 842 - margin - 5, top = profile ? Math.min(pageTop,842-profile.topMm*72/25.4) : pageTop
  const gap = style.spacing === "compact" ? 3 : 6, after = style.spacing === "compact" ? 6 : 9
  const tableSize = style.fontSize - 1, tableLeading = tableSize + (style.spacing === "compact" ? 3 : 5), padding = style.spacing === "compact" ? 8 : 12
  let page = pdf.addPage([595,842]), y = pageTop, logo: PDFImage | undefined, brandingDepth = 0
  const pages = [page]
  const beginBranding = (p: PDFPage) => p.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContent,[brandingLayer]))
  const endBranding = (p: PDFPage) => p.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent))
  function branding(operation: () => void) { if (!profile) return operation(); const first = brandingDepth++ === 0; if(first)beginBranding(page);try{operation()}finally{brandingDepth--;if(first)endBranding(page)} }
  const [logoWidth, logoHeight] = { small: [110,40], medium: [145,55], large: [180,68] }[style.logoSize]
  if(document.logoDataUrl&&(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(document.logoDataUrl)||document.logoDataUrl.length>400000))throw new BusinessError(400,"Use a bounded PNG document logo.")
  if (document.logoDataUrl || document.branding?.logo) logo = await pdf.embedPng(document.logoDataUrl ? Buffer.from(document.logoDataUrl.split(',')[1], 'base64') : await downloadDocumentLogo(document.branding!.logo!.path))
  function drawLogo() {
    if (!logo) return
    const scaled = logo.scale(Math.min(logoWidth/logo.width,logoHeight/logo.height))
    const x = margin + (style.logoAlign === "center" ? (width-scaled.width)/2 : style.logoAlign === "right" ? width-scaled.width : 0)
    branding(()=>page.drawImage(logo!,{x,y:y-scaled.height,width:scaled.width,height:scaled.height})); y-=logoHeight+13
  }
  function watermark() {
    if (!logo || !style.watermark) return
    const scaled = logo.scale(Math.min(300/logo.width,160/logo.height))
    branding(()=>page.drawImage(logo!,{x:(595-scaled.width)/2,y:(842-scaled.height)/2,width:scaled.width,height:scaled.height,opacity:.035}))
  }
  function nextPage() { if (pages.length >= 100) throw new BusinessError(413, "This document exceeds 100 pages. Shorten the template or saved details.");if(profile&&brandingDepth)endBranding(page); page = pdf.addPage([595,842]); pages.push(page); y = pageTop;if(profile&&brandingDepth)beginBranding(page); watermark(); if(style.repeatLogo)drawLogo();if(profile){if(y<top)throw new BusinessError(400,"Increase the reserved header space to fit the company logo.");y=top} }
  function ensure(height: number) { if (y-height < bottom) nextPage() }
  function wrap(value: string, maxWidth: number, size = style.fontSize) {
    const rows: string[] = []
    const clean = value.replace(/\r/g,"").replace(/\t/g," ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"")
    if ([...clean].some(c => c !== "\n" && !supported.has(c.codePointAt(0)!))) throw new BusinessError(400, "The PDF font cannot render some characters. Ask your administrator about language support.")
    for (const paragraph of clean.split("\n")) {
      let row = ""
      for (const word of paragraph.split(/\s+/)) {
        const candidate = row ? `${row} ${word}` : word
        if (font.widthOfTextAtSize(candidate,size) <= maxWidth) { row = candidate; continue }
        if (row) rows.push(row); row = ""
        for (const char of word) { if (row && font.widthOfTextAtSize(row+char,size)>maxWidth) { rows.push(row); row="" }; row+=char }
      }
      rows.push(row)
    }
    return rows
  }
  const footerLines = style.footer ? wrap(style.footer,width,8) : []
  if (footerLines.length > 6) throw new BusinessError(400,"The footer is too long for these margins. Shorten it before previewing.")
  const pageLabelY = profile ? Math.max(profile.bottomMm*72/25.4+4, footerLines.length ? footerLines.length*10+64 : 34) : 34
  const bottom = Math.max(margin+23, footerLines.length ? footerLines.length*10+64 : 0, profile ? pageLabelY+16 : 0)
  function paragraph(value: string, size = style.fontSize, color = ink, align: "left" | "center" | "right" = "left", trailing = after) { if (!value) return; for (const line of wrap(value,width,size)) { if(!line){ensure(after);y-=after;continue}ensure(size+7); const used=font.widthOfTextAtSize(line,size),x=margin+(align==="center"?(width-used)/2:align==="right"?width-used:0);page.drawText(line,{x,y,size,font,color}); y-=size+gap }; y-=trailing }
  function formatted(node:Extract<DocumentFlow[number],{runs:unknown}>) {
    const size=node.type==="heading"?node.level===1?style.fontSize+7:node.level===3?style.fontSize+1:style.fontSize+3:style.fontSize
    const indent = (node.indent ?? 0) * 24 + (node.marker ? Math.max(0,font.widthOfTextAtSize(node.marker,size)+6-24) : 0), available = width - indent
    const leading = node.lineSpacing ? size * ({ single: 1.2, "one-and-half": 1.5, double: 2 }[node.lineSpacing]) : size + gap
    const trailing = node.paragraphSpacing ? { compact: 3, normal: 9, relaxed: 15 }[node.paragraphSpacing] : after
    // Keep a template heading with the first line of the following content.
    if(node.type==="heading")ensure(Math.min(240,wrap(node.runs.map(run=>run.text).join(""),available,size).length*leading+35))
    type Piece={text:string;font:PDFFont;width:number;underline:boolean;size:number;shift:number;href?:string}
    let line:Piece[]=[],used=0,marker=node.marker
    function flush(){
      ensure(Math.max(size+7,leading));let x=margin+indent+(node.align==="center"?(available-used)/2:node.align==="right"?available-used:0)
      if(marker){page.drawText(marker,{x:margin+indent-6-font.widthOfTextAtSize(marker,size),y,size,font,color:ink});marker=undefined}
      let link: { href:string; x:number; end:number; low:number; high:number } | undefined
      function finishLink(){if(!link)return;const annotation=pdf.context.obj({Type:"Annot",Subtype:"Link",Rect:[link.x,link.low,link.end,link.high],Border:[0,0,0],A:{Type:"Action",S:"URI",URI:PDFString.of(link.href)}});const ref=pdf.context.register(annotation);const annotations=page.node.Annots();if(annotations)annotations.push(ref);else page.node.set(PDFName.of("Annots"),pdf.context.obj([ref]));link=undefined}
      for(const piece of line){
        const baseline=y+piece.shift
        page.drawText(piece.text,{x,y:baseline,size:piece.size,font:piece.font,color:ink})
        if(piece.underline&&piece.width)page.drawLine({start:{x,y:baseline-2},end:{x:x+piece.width,y:baseline-2},thickness:Math.max(.5,piece.size/18),color:ink})
        if(piece.href){if(link?.href!==piece.href)finishLink();if(!link)link={href:piece.href,x,end:x,low:baseline-3,high:baseline+piece.size};link.end=x+piece.width;link.low=Math.min(link.low,baseline-3);link.high=Math.max(link.high,baseline+piece.size)}else finishLink()
        x+=piece.width
      }
      finishLink();y-=leading;line=[];used=0
    }
    function add(text:string,f:PDFFont,underline:boolean,runSize:number,shift:number,href?:string){const w=f.widthOfTextAtSize(text,runSize);line.push({text,font:f,width:w,underline,size:runSize,shift,href});used+=w}
    for(const run of node.runs){
      const f=run.bold||node.type==="heading"?run.italic?variants.BoldItalic:variants.Bold:run.italic?variants.Italic:font
      const runSize=run.script?size*.7:size,shift=run.script==="super"?size*.35:run.script==="sub"?-size*.2:0
      const href=run.href?new URL(documentLinkSchema.parse(run.href)).href:undefined
      const clean=run.text.replace(/\r/g,"").replace(/\t/g," ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"")
      if([...clean].some(c=>c!=="\n"&&!supported.has(c.codePointAt(0)!)))throw new BusinessError(400,"The PDF font cannot render some characters. Ask your administrator about language support.")
      for(const word of clean.match(/\n|[^\S\n]+|[^\s]+/g)??[]){
        if(word==="\n"){if(line.length)flush();else{ensure(trailing);y-=trailing}continue}
        const w=f.widthOfTextAtSize(word,runSize)
        if(used+w>available&&line.length)flush()
        if(!line.length&&/^\s+$/.test(word))continue
        if(w<=available){add(word,f,!!run.underline||!!href,runSize,shift,href);continue}
        for(const char of word){if(used+f.widthOfTextAtSize(char,runSize)>available&&line.length)flush();add(char,f,!!run.underline||!!href,runSize,shift,href)}
      }
    }
    if(line.length)flush();else if(marker){ensure(size+7);page.drawText(marker,{x:margin+indent-6-font.widthOfTextAtSize(marker,size),y,size,font,color:ink});y-=leading}y-=trailing
  }
  function section(title: string, following=49) { const before=style.spacing==="compact"?6:10;ensure(before+wrap(title,width,style.fontSize+1).length*(style.fontSize+1+gap)+3+following);y-=before;paragraph(title,style.fontSize+1,ink,"left",3); }
  function table(headings: string[], rows: string[][], weights: number[]) {
    if (!headings.length || headings.length !== weights.length || weights.some(value => value <= 0) || rows.some(row => row.length !== headings.length)) throw new Error("Invalid document table")
    const total = weights.reduce((a,b)=>a+b,0), widths = weights.map(value=>width*value/total)
    function cells(lines: string[][], header: boolean) {
      const height = Math.max(...lines.map(value=>value.length),1)*tableLeading+padding
      if (header && style.tableStyle === "shaded") page.drawRectangle({x:margin,y:y-height+8,width,height,color:pale})
      let x=margin
      lines.forEach((cell,index)=>{ cell.forEach((line,i)=>page.drawText(line,{x:x+6,y:y-i*tableLeading-4,size:tableSize,font,color:header?muted:ink})); if(style.tableStyle==="grid")page.drawRectangle({x,y:y-height+8,width:widths[index],height,borderColor:muted,borderWidth:.4});x+=widths[index] })
      y-=height;if(style.tableStyle!=="grid")page.drawLine({start:{x:margin,y:y+7},end:{x:margin+width,y:y+7},color:rgb(.85,.88,.9),thickness:.4})
    }
    const headers = headings.map((value,i)=>wrap(value,widths[i]-12,tableSize)), headerHeight = Math.max(...headers.map(lines=>lines.length))*tableLeading+padding
    const freshTop = top - (style.repeatLogo && logo && !profile ? logoHeight+13 : 0)
    if(headerHeight+tableLeading+padding>freshTop-bottom)throw new BusinessError(413,"Table headings are too tall. Shorten them or use compact details.")
    const firstLines=rows[0]?.map((value,i)=>wrap(value,widths[i]-12,tableSize).length)??[1]
    ensure(headerHeight+Math.min(Math.max(...firstLines)*tableLeading+padding,freshTop-bottom-headerHeight));cells(headers,true)
    for (const row of rows) {
      const lines=row.map((value,i)=>wrap(value,widths[i]-12,tableSize));let offset=0,remaining=Math.max(...lines.map(value=>value.length),1)
      // Keep ordinary rows together; split only a cell taller than a fresh page.
      const freshCapacity=Math.floor((freshTop-headerHeight-bottom-padding)/tableLeading)
      if(remaining<=freshCapacity && y-(remaining*tableLeading+padding)<bottom){nextPage();cells(headers,true)}
      while (remaining>0) {
        let capacity=Math.floor((y-bottom-padding)/tableLeading)
        if (capacity<1) { nextPage();cells(headers,true);capacity=Math.floor((y-bottom-padding)/tableLeading) }
        const count=Math.min(capacity,remaining)
        cells(lines.map(value=>value.slice(offset,offset+count)),false);offset+=count;remaining-=count
      }
    }
    y-=style.spacing==="compact"?8:13
  }
  watermark();drawLogo()
  if(style.companyHeading)branding(()=>paragraph(document.company.name,style.fontSize+7))
  if(profile){if(document.issuer.address)branding(()=>paragraph(document.issuer.address,9,muted));if(y<top)throw new BusinessError(400,"Increase the reserved header space or shorten the company's digital header before previewing.");y=top}
  paragraph(document.title,style.titleSize,ink,style.titleAlign)
  if(style.referenceLayout==="split"){
    const left=wrap(document.reference,width*.65-8,9),right=wrap(document.date,width*.35,9)
    for(let i=0;i<Math.max(left.length,right.length);i++){ensure(16);if(left[i])page.drawText(left[i],{x:margin,y,size:9,font,color:muted});if(right[i])page.drawText(right[i],{x:margin+width-font.widthOfTextAtSize(right[i],9),y,size:9,font,color:muted});y-=9+gap}y-=after
  }else paragraph(`${document.reference} | ${document.date}`,9,muted)
  if (preview) paragraph("DRAFT PREVIEW - NOT ISSUED",10,muted)
  if (document.issuer.address && !profile) paragraph(document.issuer.address,9,muted)
  async function drawBlocks(blocks:DocumentPayload["blocks"],compact=false){for (const block of blocks) {
    let following=49
    if(block.table&&!block.paragraphs?.length&&!compact){const t=block.table,total=t.widths.reduce((a,b)=>a+b,0),count=(row:string[])=>Math.max(...row.map((value,i)=>wrap(value,width*t.widths[i]/total-12,tableSize).length),1);following=Math.min(240,(count(t.headings)+count(t.rows[0]??t.headings))*tableLeading+30)}
    section(block.title,following);for (const text of block.paragraphs??[]) paragraph(text,style.fontSize,ink,"left",compact?2:after);if (block.table) {
      if(compact){const t=block.table;for(const row of t.rows)paragraph(row.length===2?`${row[0]}: ${row[1]}`:row.map((cell,i)=>`${t.headings[i]}: ${cell}`).join(" | "),style.fontSize,ink,"left",2);if(!t.rows.length)paragraph(t.headings.join(" | "))}
      else table(block.table.headings,block.table.rows,block.table.widths)
    }
    if(compact)y-=after-2
    if(block.qrCode){if(block.qrCode.length>1000||!/^https?:\/\//.test(block.qrCode))throw new BusinessError(400,"Invalid document registration link.");ensure(90);const image=await pdf.embedPng(await QRCode.toBuffer(block.qrCode,{width:240,margin:2,errorCorrectionLevel:'M'}));page.drawImage(image,{x:margin,y:y-80,width:80,height:80});y-=92}
  }}
  if(document.body){for(const node of document.body){if(node.type==="section")await drawBlocks(node.blocks,node.compact);else if(node.type==="pageBreak")nextPage();else if(node.type==="rule"){ensure(20);y-=6;page.drawLine({start:{x:margin,y},end:{x:margin+width,y},thickness:.6,color:muted});y-=14}else formatted(node)}}
  else{paragraph(document.opening);await drawBlocks(document.blocks);if (document.terms) { section("Terms and notes");paragraph(document.terms) }}
  if(document.showSignatory!==false){const contactHeight=document.issuer.contact?wrap(document.issuer.contact,width,9).length*(9+gap)+after:0;const height=6+9+gap+3+(wrap(document.company.name,width).length+wrap(document.issuer.signatory,width).length)*(style.fontSize+gap)+after*2+12+contactHeight;ensure(height);y-=6;paragraph("Issued by",9,muted,"left",3);paragraph(document.company.name);y-=12;paragraph(document.issuer.signatory)}
  if (document.issuer.contact) branding(()=>paragraph(document.issuer.contact,9,muted))
  if(document.notice)paragraph(document.notice,9,muted)
  pages.forEach((p,i)=>{
    if(footerLines.length){if(profile)beginBranding(p);const ruleY=50+footerLines.length*10+4;p.drawLine({start:{x:margin,y:ruleY},end:{x:margin+width,y:ruleY},thickness:.4,color:muted});footerLines.forEach((line,index)=>p.drawText(line,{x:margin+(width-font.widthOfTextAtSize(line,8))/2,y:50+(footerLines.length-1-index)*10,size:8,font,color:muted}));if(profile)endBranding(p)}
    // References can be long; retain the complete identity even with narrow pages.
    const label=`${preview?"DRAFT | ":""}${document.reference} | Page ${i+1} / ${pages.length}`,size=Math.min(8,width/font.widthOfTextAtSize(label,1));p.drawText(label,{x:margin,y:pageLabelY,size,font,color:muted})
  })
  pdf.setTitle(document.title);pdf.setAuthor(document.company.name);pdf.setSubject(document.reference)
  const bytes = await pdf.save()
  return variant === "letterhead" ? letterheadPdf(bytes) : bytes
}
