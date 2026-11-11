import { storageClient } from "@/platform/storage/client"
import { BusinessError } from "@/platform/policy"
import { EVIDENCE_LIMIT, evidenceTypes } from "./evidence-contracts"
export const EVIDENCE_BUCKET = "tenant-verification"
export type EvidenceStorage = { signUpload(path: string): Promise<string>; read(path: string): Promise<Uint8Array>; download(path: string, filename: string): Promise<string>; remove(path: string): Promise<void> }
export function evidencePath(tenantId: string, caseId: string, id: string, contentType: string) {
  return validEvidencePath(`${tenantId}/cases/${caseId}/${id}.${contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg"}`)
}
export function validEvidencePath(path: string) {
  if (!/^[A-Za-z0-9_-]+\/cases\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}\.(pdf|png|jpg)$/.test(path)) throw Error("Invalid verification evidence path")
  return path
}
async function bucket() {
  const client = storageClient(), result = await client.storage.getBucket(EVIDENCE_BUCKET)
  if (result.error || !result.data || result.data.public || Number(result.data.file_size_limit) !== EVIDENCE_LIMIT || [...result.data.allowed_mime_types ?? []].sort().join() !== [...evidenceTypes].sort().join()) throw new BusinessError(503, "Private verification storage is not configured correctly. Contact your platform administrator.")
  return client.storage.from(EVIDENCE_BUCKET)
}
export const privateEvidenceStorage: EvidenceStorage = {
  async signUpload(path) {
    const { data, error } = await (await bucket()).createSignedUploadUrl(validEvidencePath(path), { upsert: false })
    if (error || !data) throw new BusinessError(503, "Unable to prepare the private upload. Try again.")
    return data.signedUrl
  },
  async read(path) {
    const { data, error } = await (await bucket()).download(validEvidencePath(path))
    if (error || !data) throw new BusinessError(503, "The upload is not available yet. Retry finalisation or upload the file again.")
    if (data.size > EVIDENCE_LIMIT) throw new BusinessError(413, "This upload exceeds the 5 MB limit.")
    return new Uint8Array(await data.arrayBuffer())
  },
  async download(path, filename) {
    const { data, error } = await (await bucket()).createSignedUrl(validEvidencePath(path), 60, { download: filename })
    if (error || !data) throw new BusinessError(503, "The evidence file is unavailable. Try again.")
    return data.signedUrl
  },
  async remove(path) {
    const { error } = await (await bucket()).remove([validEvidencePath(path)])
    if (error) throw new BusinessError(503, "Unable to clean up the expired upload. Try again.")
  },
}
