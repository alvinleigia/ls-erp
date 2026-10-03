import { businessDisplayName } from "@/lib/branding"
import { PDFDocument, StandardFonts } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import fs from "fs"

import type { AppointmentOrderRow } from "@/types/appointments"
import type { AppSettingsPayload } from "@/types/scheduling"
import {
  formatCurrencyFromCents,
  formatNumberValue,
  formatTimeFromDate,
} from "@/lib/formatting"
import { DEFAULT_DATE_FORMAT, formatDateForDisplay } from "@/lib/date"

type InvoiceInput = {
  businessName?: string | null
  order: AppointmentOrderRow
  settings?: Pick<
    AppSettingsPayload,
    | "locale"
    | "currency"
    | "currencySymbolPlacement"
    | "numberFormat"
    | "dateFormat"
    | "timeFormat"
  >
}

const formatDateTime = (
  value: string,
  format?: string,
  timeFormat?: AppSettingsPayload["timeFormat"]
) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const dateLabel = formatDateForDisplay(value, format ?? DEFAULT_DATE_FORMAT)
  const timeLabel = formatTimeFromDate(parsed, { timeFormat })
  return `${dateLabel} ${timeLabel}`
}

export const buildAppointmentOrderInvoicePdf = async ({
  order,
  settings,
  businessName,
}: InvoiceInput): Promise<Buffer> => {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)

  const fontCandidates = [
    process.env.INVOICE_FONT_PATH,
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\seguiemj.ttf",
  ].filter(Boolean) as string[]

  const resolveFontBytes = () => {
    for (const candidate of fontCandidates) {
      try {
        if (fs.existsSync(candidate)) {
          return fs.readFileSync(candidate)
        }
      } catch {
        // Continue to next candidate.
      }
    }
    return null
  }

  const fontBytes = resolveFontBytes()
  const hasUnicodeFont = Boolean(fontBytes)

  const font = fontBytes
    ? await pdf.embedFont(fontBytes, { subset: true })
    : await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = fontBytes
    ? await pdf.embedFont(fontBytes, { subset: true })
    : await pdf.embedFont(StandardFonts.HelveticaBold)

  const safeText = (text: string) =>
    hasUnicodeFont
      ? text
      : text.replace(/\u20B9/g, "Rs ").replace(/[^\x20-\x7E]/g, "")

  const formatNumberFromCents = (cents: number) => {
    const value = cents / 100
    return formatNumberValue(value, settings?.numberFormat, 2)
  }

  const receiptWidth = 226 // ~80mm
  const baseHeight = 260
  const lineHeight = 14
  const extraLines =
    order.lines.length * 3 +
    (order.taxes.length ? order.taxes.length + 3 : 0) +
    8
  const receiptHeight = baseHeight + extraLines * lineHeight
  const page = pdf.addPage([receiptWidth, receiptHeight])

  const margin = 12
  const contentWidth = receiptWidth - margin * 2
  let y = receiptHeight - margin

  const drawText = (text: string, size = 9, x = margin, useBold = false) => {
    page.drawText(safeText(text), { x, y, size, font: useBold ? boldFont : font })
    y -= size + 4
  }

  const drawCentered = (text: string, size = 9, useBold = false) => {
    const safe = safeText(text)
    const textWidth = (useBold ? boldFont : font).widthOfTextAtSize(safe, size)
    const x = Math.max(margin, margin + (contentWidth - textWidth) / 2)
    page.drawText(safe, { x, y, size, font: useBold ? boldFont : font })
    y -= size + 4
  }

  const drawSeparator = (size = 9) => {
    const dashWidth = font.widthOfTextAtSize("-", size)
    const count = Math.max(1, Math.floor(contentWidth / dashWidth))
    drawText("-".repeat(count), size)
  }

  const totalRightX = receiptWidth - margin

  const drawLabelValue = (label: string, value: string) => {
    const size = 9
    const safeLabel = safeText(label)
    const safeValue = safeText(value)
    const valueWidth = font.widthOfTextAtSize(safeValue, size)
    page.drawText(safeLabel, { x: margin, y, size, font })
    page.drawText(safeValue, { x: totalRightX - valueWidth, y, size, font })
    y -= size + 4
  }

  const drawCenteredPair = (left: string, right: string, size = 8, gap = 16) => {
    const safeLeft = safeText(left)
    const safeRight = safeText(right)
    const leftWidth = font.widthOfTextAtSize(safeLeft, size)
    const rightWidth = font.widthOfTextAtSize(safeRight, size)
    if (!safeLeft && !safeRight) return
    if (!safeLeft) {
      const x = Math.max(margin, margin + (contentWidth - rightWidth) / 2)
      page.drawText(safeRight, { x, y, size, font })
      y -= size + 4
      return
    }
    if (!safeRight) {
      const x = Math.max(margin, margin + (contentWidth - leftWidth) / 2)
      page.drawText(safeLeft, { x, y, size, font })
      y -= size + 4
      return
    }
    const totalWidth = leftWidth + gap + rightWidth
    const startX = Math.max(margin, margin + (contentWidth - totalWidth) / 2)
    page.drawText(safeLeft, { x: startX, y, size, font })
    page.drawText(safeRight, { x: startX + leftWidth + gap, y, size, font })
    y -= size + 4
  }

  const splitWrappedLines = (text: string, size = 9, maxWidth = contentWidth) => {
    const words = safeText(text).split(/\s+/)
    let line = ""
    const lines: string[] = []
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word
      const width = font.widthOfTextAtSize(next, size)
      if (width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    })
    if (line) lines.push(line)
    return lines
  }

  const headerLines = (businessName?.trim() || process.env.INVOICE_HEADER_LINES || businessDisplayName()).split("|")
  headerLines.filter(Boolean).forEach((line, index) => {
    drawCentered(line.trim(), index === 0 ? 12 : 9, index === 0)
  })
  drawCentered("Invoice", 10, true)
  drawCentered(
    `Date: ${formatDateTime(order.appointmentStartAt, settings?.dateFormat, settings?.timeFormat)}`,
    9
  )
  drawSeparator()

  drawCentered(order.customer?.name || order.customer?.email || "Customer", 9, true)
  const customerPhone = (order.customer as { phone?: string } | null)?.phone ?? ""
  const customerEmail = order.customer?.email ?? ""
  if (customerPhone || customerEmail) {
    const left = customerPhone ? `Mobile: ${customerPhone}` : ""
    const right = customerEmail ? `Email: ${customerEmail}` : ""
    drawCenteredPair(left, right, 8)
  }
  drawSeparator()

  const tableColumns = {
    name: margin,
    qty: margin + 110,
    rate: margin + 145,
    tax: margin + 175,
    total: totalRightX,
  }

  const headerSize = 8
  page.drawText("Item", { x: tableColumns.name, y, size: headerSize, font: boldFont })
  const qtyHeaderWidth = font.widthOfTextAtSize("Qty", headerSize)
  const rateHeaderWidth = font.widthOfTextAtSize("Rate", headerSize)
  const taxHeaderWidth = font.widthOfTextAtSize("Tax", headerSize)
  const totalHeaderWidth = font.widthOfTextAtSize("Total", headerSize)
  page.drawText("Qty", { x: tableColumns.qty - qtyHeaderWidth, y, size: headerSize, font: boldFont })
  page.drawText("Rate", { x: tableColumns.rate - rateHeaderWidth, y, size: headerSize, font: boldFont })
  page.drawText("Tax", { x: tableColumns.tax - taxHeaderWidth, y, size: headerSize, font: boldFont })
  page.drawText("Total", { x: tableColumns.total - totalHeaderWidth, y, size: headerSize, font: boldFont })
  y -= 12
  drawSeparator()

  order.lines.forEach((line) => {
    const name = line.service?.name || "Service"
    const unitNetCents =
      line.taxMode === "INCLUSIVE"
        ? Math.max(0, line.unitPriceCents - Math.round(line.lineTaxCents / Math.max(1, line.quantity)))
        : line.unitPriceCents
    const nameLines = splitWrappedLines(
      name,
      9,
      tableColumns.qty - tableColumns.name - 6
    )
    const qtyText = String(line.quantity)
    const rateText = formatNumberFromCents(unitNetCents)
    const taxText = formatNumberFromCents(line.lineTaxCents)
    const totalText = formatNumberFromCents(line.lineTotalCents)
    const qtyWidth = font.widthOfTextAtSize(qtyText, 8)
    const rateWidth = font.widthOfTextAtSize(safeText(rateText), 8)
    const taxWidth = font.widthOfTextAtSize(safeText(taxText), 8)
    const totalWidth = font.widthOfTextAtSize(safeText(totalText), 8)

    const firstLine = nameLines[0] ?? name
    page.drawText(firstLine, { x: tableColumns.name, y, size: 9, font })
    page.drawText(qtyText, { x: tableColumns.qty - qtyWidth, y, size: 8, font })
    page.drawText(rateText, { x: tableColumns.rate - rateWidth, y, size: 8, font })
    page.drawText(taxText, { x: tableColumns.tax - taxWidth, y, size: 8, font })
    page.drawText(totalText, { x: tableColumns.total - totalWidth, y, size: 8, font })
    y -= 12

    nameLines.slice(1).forEach((lineItem) => {
      page.drawText(lineItem, { x: tableColumns.name, y, size: 9, font })
      y -= 12
    })
  })

  drawSeparator()
  drawLabelValue("Subtotal", formatCurrencyFromCents(order.subtotalCents, settings))
  if (order.lineDiscountCents > 0) {
    drawLabelValue(
      "Line discounts",
      formatCurrencyFromCents(-order.lineDiscountCents, settings)
    )
  }
  if (order.couponDiscountCents > 0) {
    drawLabelValue("Coupon", formatCurrencyFromCents(-order.couponDiscountCents, settings))
  }
  drawLabelValue("Tax", formatCurrencyFromCents(order.taxCents, settings))
  drawSeparator()
  drawLabelValue("Total", formatCurrencyFromCents(order.totalCents, settings))

  if (order.taxes.length) {
    drawSeparator()
    y -= 2
    drawText("Tax breakdown", 8, margin, true)
    order.taxes.forEach((tax) => {
      drawLabelValue(
        `${tax.name} ${tax.percent}%`,
        formatCurrencyFromCents(tax.taxCents, settings)
      )
    })
  }

  drawSeparator()
  drawCentered("Thank you!", 8, true)

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
