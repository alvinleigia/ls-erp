import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { downloadDocumentLogo } from "../branding/storage"
import { BusinessError } from "../policy"
import type { DocumentPayload } from "./contracts"

// Registered providers supply plain text and tables. No HTML, expressions,
// arbitrary image URLs or industry-specific fields enter this renderer.
export async function renderBusinessDocument(document: DocumentPayload, preview = false) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await readFile(path.join(process.cwd(), "public/assets/fonts/NotoSans-Regular.ttf")), { subset: true })
  const supported = new Set(font.getCharacterSet()), ink = rgb(.1,.15,.2), muted = rgb(.36,.4,.44), pale = rgb(.94,.96,.97)
  const width = 511, margin = 42, bottom = 65
  let page = pdf.addPage([595,842]), y = 795
  const pages = [page]
  function nextPage() { if (pages.length >= 100) throw new BusinessError(413, "This document exceeds 100 pages. Shorten the template or saved details."); page = pdf.addPage([595,842]); pages.push(page); y = 795 }
  function ensure(height: number) { if (y-height < bottom) nextPage() }
  function wrap(value: string, maxWidth: number, size = 10) {
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
  function paragraph(value: string, size = 10, color = ink) { if (!value) return; for (const line of wrap(value,width,size)) { ensure(size+7); page.drawText(line,{x:margin,y,size,font,color}); y-=size+6 }; y-=6 }
  function section(title: string, following=49) { ensure(wrap(title,width,12).length*18+following); y-=7; paragraph(title,12); }
  function table(headings: string[], rows: string[][], weights: number[]) {
    if (!headings.length || headings.length !== weights.length || weights.some(value => value <= 0) || rows.some(row => row.length !== headings.length)) throw new Error("Invalid document table")
    const total = weights.reduce((a,b)=>a+b,0), widths = weights.map(value=>width*value/total)
    function cells(lines: string[][], header: boolean) {
      const height = Math.max(...lines.map(value=>value.length),1)*14+12
      if (header) page.drawRectangle({x:margin,y:y-height+8,width,height,color:pale})
      let x=margin
      lines.forEach((cell,index)=>{ cell.forEach((line,i)=>page.drawText(line,{x:x+6,y:y-i*14-4,size:9,font,color:header?muted:ink}));x+=widths[index] })
      y-=height;page.drawLine({start:{x:margin,y:y+7},end:{x:margin+width,y:y+7},color:rgb(.85,.88,.9),thickness:.4})
    }
    const headers = headings.map((value,i)=>wrap(value,widths[i]-12,9)), headerHeight = Math.max(...headers.map(lines=>lines.length))*14+12
    ensure(headerHeight+36);cells(headers,true)
    for (const row of rows) {
      const lines=row.map((value,i)=>wrap(value,widths[i]-12,9));let offset=0,remaining=Math.max(...lines.map(value=>value.length),1)
      // Keep ordinary rows together; split only a cell taller than a fresh page.
      const freshCapacity=Math.floor((795-headerHeight-bottom-12)/14)
      if(remaining<=freshCapacity && y-(remaining*14+12)<bottom){nextPage();cells(headers,true)}
      while (remaining>0) {
        let capacity=Math.floor((y-bottom-12)/14)
        if (capacity<1) { nextPage();cells(headers,true);capacity=Math.floor((y-bottom-12)/14) }
        const count=Math.min(capacity,remaining)
        cells(lines.map(value=>value.slice(offset,offset+count)),false);offset+=count;remaining-=count
      }
    }
    y-=13
  }
  if (document.branding?.logo) {
    const logo=await pdf.embedPng(await downloadDocumentLogo(document.branding.logo.path)),scaled=logo.scale(Math.min(145/logo.width,55/logo.height))
    page.drawImage(logo,{x:margin,y:y-scaled.height,width:scaled.width,height:scaled.height});y-=68
  }
  paragraph(document.company.name,17);paragraph(document.title,20)
  paragraph(`${document.reference} | ${document.date}`,9,muted)
  if (preview) paragraph("DRAFT PREVIEW - NOT ISSUED",10,muted)
  if (document.issuer.address) paragraph(document.issuer.address,9,muted)
  paragraph(document.opening)
  for (const block of document.blocks) {
    let following=49
    if(block.table&&!block.paragraphs?.length){const t=block.table,total=t.widths.reduce((a,b)=>a+b,0),count=(row:string[])=>Math.max(...row.map((value,i)=>wrap(value,width*t.widths[i]/total-12,9).length),1);following=Math.min(240,(count(t.headings)+count(t.rows[0]??t.headings))*14+30)}
    section(block.title,following);for (const text of block.paragraphs??[]) paragraph(text);if (block.table) table(block.table.headings,block.table.rows,block.table.widths)
  }
  if (document.terms) { section("Terms and notes");paragraph(document.terms) }
  section("Issued by");paragraph(document.company.name);paragraph(document.issuer.signatory)
  if (document.issuer.contact) paragraph(document.issuer.contact,9,muted)
  pages.forEach((p,i)=>p.drawText(`${preview?"DRAFT | ":""}${document.reference} | Page ${i+1} / ${pages.length}`,{x:margin,y:34,size:8,font,color:muted}))
  pdf.setTitle(document.title);pdf.setAuthor(document.company.name);pdf.setSubject(document.reference)
  return pdf.save()
}
