import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { readFile } from "node:fs/promises"
import path from "node:path"
import QRCode from "qrcode"
import { formatDateForDisplay } from "@/lib/date"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { QuotationSnapshot } from "./quotation-service"
import { CrmError } from "@/modules/crm/policy"

export async function buildQuotationPdf(record: { id: string; revision: number; revisionCreatedAt: Date | string; snapshot: QuotationSnapshot }) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await readFile(path.join(process.cwd(), "public/assets/fonts/NotoSans-Regular.ttf")), { subset: true })
  const supportedCharacters = new Set(font.getCharacterSet())
  const { content: c, calculation: calc } = record.snapshot
  const money = (value: string) => formatDecimalCurrency(value, c.currency, record.snapshot)
  const date = (value: string) => formatDateForDisplay(value, record.snapshot.dateFormat)
  const ink = rgb(.10, .15, .20), muted = rgb(.36, .40, .44), accent = rgb(.06, .29, .32), pale = rgb(.94, .97, .97)
  const margin = 42, width = 511
  let page = pdf.addPage([595, 842]), y = 800
  const pages = [page]
  const clean = (value: string) => value.replace(/\r/g, "").replace(/\t/g, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
  function wrapped(value: string, maxWidth: number, size = 10) {
    const rows: string[] = []
    for (const paragraph of clean(value).split("\n")) {
      if ([...paragraph].some(char => !supportedCharacters.has(char.codePointAt(0)!))) throw new CrmError(400, "The PDF could not render some characters. Contact your administrator for language support.")
      let row = ""
      for (const word of paragraph.split(/\s+/)) {
        const candidate = row ? `${row} ${word}` : word
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { row = candidate; continue }
        if (row) rows.push(row)
        row = ""
        // Split only tokens too long to fit, such as URLs and account numbers.
        for (const char of word) { if (font.widthOfTextAtSize(row + char, size) > maxWidth && row) { rows.push(row); row = "" }; row += char }
      }
      rows.push(row)
    }
    return rows
  }
  function ensure(height: number) { if (y - height < 48) { page = pdf.addPage([595, 842]); pages.push(page); y = 800; page.drawText(`${c.supplierName.slice(0, 70)} · Continued`, { x: margin, y, size: 9, font, color: muted }); y -= 26 } }
  function paragraph(value: string, size = 10, color = ink) { for (const row of wrapped(value, width, size)) { ensure(size + 6); page.drawText(row, { x: margin, y, size, font, color }); y -= size + 6 }; y -= 4 }
  function section(title: string) { ensure(65); y -= 8; page.drawRectangle({ x: margin, y: y - 10, width, height: 27, color: pale }); page.drawText(title, { x: margin + 9, y, size: 11, font, color: accent }); y -= 30 }
  function table(headers: string[], rows: string[][], widths: number[]) {
    const draw = (cells: string[], header = false) => {
      const lines = cells.map((cell, index) => wrapped(cell, widths[index] - 14, header ? 9 : 10))
      const height = Math.max(...lines.map(item => item.length)) * 14 + 14
      ensure(height)
      if (header) page.drawRectangle({ x: margin, y: y - height + 6, width, height, color: pale })
      let x = margin
      for (const [index, linesOfCell] of lines.entries()) { linesOfCell.forEach((line, i) => page.drawText(line, { x: x + 7, y: y - 8 - i * 14, size: header ? 9 : 10, font, color: header ? accent : ink })); x += widths[index] }
      y -= height
      page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: margin + width, y: y + 6 }, color: rgb(.85, .88, .90), thickness: .4 })
    }
    draw(headers, true)
    for (const row of rows) {
      const h = Math.max(...row.map((cell, i) => wrapped(cell, widths[i] - 14).length)) * 14 + 14
      if (y - h < 48) { ensure(h + 28); draw(headers, true) }
      draw(row)
    }
    y -= 9
  }
  if (c.logoDataUrl) {
    const logo = await pdf.embedPng(c.logoDataUrl), scaled = logo.scale(Math.min(130 / logo.width, 50 / logo.height))
    page.drawImage(logo, { x: margin, y: y - scaled.height, width: scaled.width, height: scaled.height }); y -= 65
  }
  paragraph(c.supplierName, 17, accent); paragraph(c.title, 21)
  paragraph(`Reference ${record.id}  |  Version ${record.revision}  |  ${date(new Date(record.revisionCreatedAt).toISOString().slice(0, 10))}`, 8, muted)
  paragraph(`Prepared for ${record.snapshot.customer.name}`, 11)
  const contact = [record.snapshot.customer.email, record.snapshot.customer.phone].filter(Boolean).join(" · ")
  if (contact) paragraph(contact, 9, muted)
  paragraph(`Opportunity: ${record.snapshot.opportunity}`, 9, muted)
  if (c.bookingDate) paragraph(`Booking date: ${date(c.bookingDate)}`, 9)
  if (c.validUntil) paragraph(`Valid until: ${date(c.validUntil)}`, 9)
  if (record.snapshot.context.length || c.details.length) {
    section("Reference details")
    table(["Detail", "Value"], [...record.snapshot.context, ...c.details].map(item => [item.label, item.value]), [160, 351])
  }
  section("Price")
  table(["Description", "Quantity / unit", "Rate", "Amount"], calc.lines.map(line => [line.description, `${line.quantity} ${line.unit}`, money(line.rate), money(line.amount)]), [195, 96, 105, 115])
  table(["Summary", "Amount"], [["Base price", money(calc.base)], ["Included charges", money(calc.included)], ["Discount", money(calc.discount)], ["Total consideration", money(calc.consideration)]], [350, 161])
  if (calc.charges.length) {
    section("Charges and payment conditions")
    table(["Charge", "Amount / calculation", "Due / conditions"], calc.charges.map(charge => [
      `${charge.label}\n${charge.included ? "Included in consideration" : "Extra charge"}`,
      `${charge.amount === null ? "To be confirmed" : money(charge.amount)}${charge.kind === "PERCENT" ? `\n${charge.value}% of ${charge.basis === "BASE" ? "base price" : "consideration"}` : ""}`, charge.due || "Not specified",
    ]), [165, 150, 196])
    for (const group of calc.groups) paragraph(`${group.label} subtotal (${group.included ? "included" : "extra"}${group.hasPending ? ", known amounts" : ""}): ${money(group.amount)}`, 10)
    paragraph(`Extra charges (known): ${money(calc.extras)}`)
    paragraph(`Total known amount: ${money(calc.totalKnown)}`, 12, accent)
    if (calc.hasPending) paragraph("Pending charges are additional and are not included in the total known amount.", 9, muted)
  }
  if (calc.instalments.length) {
  section("Instalment schedule")
  paragraph("Instalments cover total consideration. Extra charges follow their separate payment conditions.", 9, muted)
  table(["Milestone", "%", "Amount", "Due / conditions"], calc.instalments.map(item => [item.label, item.percent, money(item.amount), [item.days ? `${item.days} days from booking` : "On booking", item.dueDate ? date(item.dueDate) : "", item.note].filter(Boolean).join("\n")]), [144, 44, 123, 200])
  paragraph(`Total instalments: ${money(calc.consideration)} (100%)`, 11, accent)
  }
  if (Object.values(c.bank).some(Boolean)) {
    section("Bank details")
    table(["Detail", "Value"], Object.entries({ accountName: "Account name", accountNumber: "Account number", accountType: "Account type", bankName: "Bank", branch: "Branch", routingCode: "IFSC / routing code" }).filter(([key]) => c.bank[key as keyof typeof c.bank]).map(([key, label]) => [label, c.bank[key as keyof typeof c.bank]]), [160, 351])
  }
  if (c.terms) { section("Terms and remarks"); paragraph(c.terms, 9) }
  if (c.registration || c.registrationUrl) {
    section("Registration")
    if (c.registration) paragraph(c.registration)
    if (c.registrationUrl) { paragraph(c.registrationUrl, 8, muted); ensure(90); const qr = await pdf.embedPng(await QRCode.toBuffer(c.registrationUrl, { width: 240, margin: 2, errorCorrectionLevel: "M" })); page.drawImage(qr, { x: margin, y: y - 80, width: 80, height: 80 }); y -= 90 }
  }
  if (c.website) paragraph(c.website, 9, accent)
  paragraph("Quotation / payment instructions only. This document is not a payment receipt.", 8, muted)
  pages.forEach((p, index) => p.drawText(`Version ${record.revision} · Page ${index + 1} of ${pages.length}`, { x: margin, y: 24, size: 8, font, color: muted }))
  pdf.setTitle(c.title); pdf.setAuthor(c.supplierName)
  return pdf.save()
}
