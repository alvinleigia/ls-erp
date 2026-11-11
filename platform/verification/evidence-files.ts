import { createHash } from "node:crypto"
import sharp from "sharp"
import { PDFDocument } from "pdf-lib"
import { BusinessError } from "@/platform/policy"
import { EVIDENCE_LIMIT, evidenceTypes } from "./evidence-contracts"

// Inspect originals without rewriting or rendering uploaded documents. This is
// type/structure validation, not a malware scan or identity verification.
export async function validateEvidenceFile(bytes: Uint8Array, expected: { bytes: number; contentType: string }) {
  if (!bytes.length || bytes.length > EVIDENCE_LIMIT) throw new BusinessError(413, "Evidence files must be between 1 byte and 5 MB.")
  if (bytes.length !== expected.bytes) throw new BusinessError(400, "The uploaded file size does not match the selected file. Upload it again.")
  if (!(evidenceTypes as readonly string[]).includes(expected.contentType)) throw new BusinessError(400, "Unsupported evidence file type.")
  try {
    if (expected.contentType === "application/pdf") {
      const text = Buffer.from(bytes)
      if (!text.subarray(0, 8).toString("ascii").match(/^%PDF-1\.[0-9]/) && !text.subarray(0, 8).toString("ascii").startsWith("%PDF-2.0")) throw Error("PDF header")
      if (!text.subarray(-1024).includes(Buffer.from("%%EOF"))) throw Error("PDF trailer")
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
      if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw Error("Unsupported PDF")
    } else {
      const format = expected.contentType === "image/png" ? "png" : "jpeg"
      const input = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" })
      const meta = await input.metadata()
      if (meta.format !== format || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw Error("Image format")
      await input.stats() // Decode the complete image; a spoofed header is insufficient.
    }
  } catch { throw new BusinessError(400, "Upload a valid, unencrypted PDF (up to 100 pages), JPEG or PNG image. Its content must match the selected file type.") }
  return { sha256: createHash("sha256").update(bytes).digest("hex") }
}
