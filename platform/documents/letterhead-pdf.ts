import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib"
import { BusinessError } from "../policy"

export const letterheadMarker = PDFName.of("ERPCompanyLetterheadVersion")
export const brandingLayer = PDFName.of("ERPCompanyBranding")

// Derive a print copy from the archived bytes, retaining the exact body, fonts,
// source values, pagination and annotations. Never re-resolve a live template.
export async function letterheadPdf(bytes: Uint8Array) {
  if (bytes.length > 10 * 1024 * 1024) throw new BusinessError(413, "This PDF exceeds the document limit.")
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  if (pdf.catalog.get(letterheadMarker)?.toString() !== "1" || pdf.catalog.has(PDFName.of("AcroForm"))) throw new BusinessError(409, "Letterhead printing is unavailable for this issued version. Use its original PDF or prepare a reviewed replacement.")
  if (pdf.getPageCount() > 100) throw new BusinessError(413, "This document exceeds 100 pages.")
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
    const clean = streams.map(ref => {
      const stream = pdf.context.lookup(ref)
      if (!(stream instanceof PDFRawStream)) throw new BusinessError(409, "This PDF cannot be prepared for letterhead printing.")
      const text = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")
      const stripped = text.replace(/\/ERPCompanyBranding BMC\s*\n[\s\S]*?\nEMC\s*\n/g, "")
      if (stripped.includes("/ERPCompanyBranding BMC")) throw new BusinessError(409, "The archived branding layer is incomplete.")
      return pdf.context.register(pdf.context.flateStream(Buffer.from(stripped, "latin1")))
    })
    page.node.set(PDFName.of("Contents"), pdf.context.obj(clean))
  }
  pdf.catalog.delete(letterheadMarker)
  return pdf.save()
}

export function markLetterheadPdf(pdf: PDFDocument) { pdf.catalog.set(letterheadMarker, PDFNumber.of(1)) }
