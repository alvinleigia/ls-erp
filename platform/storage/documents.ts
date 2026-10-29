import { createHash, randomUUID } from "node:crypto"
import { BusinessError } from "../policy"
import { storageClient } from "./client"

export const DOCUMENT_BUCKET = "tenant-documents"
export const DOCUMENT_LIMIT = 10 * 1024 * 1024
export type ArchivedPdf = { path: string; bytes: number; sha256: string; issuedAt: string; issuedBy: string }
function validPath(path: string) {
  if (!/^[a-zA-Z0-9_-]+\/(?:quotations\/[a-zA-Z0-9_-]+\/[1-9][0-9]*|(?:orders|receipts)\/[a-zA-Z0-9_-]+\/[a-f0-9-]{36})\/[a-f0-9-]{36}\.pdf$/.test(path)) throw new Error("Invalid archived document path")
  return path
}
export async function uploadQuotationPdf(tenantId: string, id: string, revision: number, bytes: Uint8Array) {
  return upload(validPath(`${tenantId}/quotations/${id}/${revision}/${randomUUID()}.pdf`), bytes)
}
export async function uploadOrderDocumentPdf(tenantId: string, orderId: string, id: string, bytes: Uint8Array) {
  return upload(validPath(`${tenantId}/orders/${orderId}/${id}/${randomUUID()}.pdf`), bytes)
}
export async function uploadReceiptDocumentPdf(tenantId: string, paymentId: string, id: string, bytes: Uint8Array) {
  return upload(validPath(`${tenantId}/receipts/${paymentId}/${id}/${randomUUID()}.pdf`), bytes)
}
async function upload(path: string, bytes: Uint8Array) {
  if (bytes.length > DOCUMENT_LIMIT) throw new BusinessError(413, "This PDF exceeds the 10 MB document limit.")
  const { error } = await storageClient().storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false })
  if (error) throw new BusinessError(503, "Unable to archive this PDF. Please try again.")
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
}
export async function removeUnusedPdf(path: string) {
  const { error } = await storageClient().storage.from(DOCUMENT_BUCKET).remove([validPath(path)])
  if (error) throw new Error("Unable to remove unused document")
}
export async function archivedPdfUrl(path: string, filename: string) {
  const { data, error } = await storageClient().storage.from(DOCUMENT_BUCKET).createSignedUrl(validPath(path), 60, { download: filename })
  if (error || !data) throw new BusinessError(503, "The archived PDF is unavailable. Please try again.")
  return data.signedUrl
}
