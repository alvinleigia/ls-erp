import { createHash } from "node:crypto"
import { storageClient } from "@/platform/storage/client"
import { BusinessError } from "@/platform/policy"
import { EVIDENCE_BUCKET, validEvidencePath, privateEvidenceStorage } from "./evidence-storage"
import { EVIDENCE_LIMIT, evidenceTypes } from "./evidence-contracts"
export type DisposalStorage = { inspect(path: string): Promise<{ exists: false } | { exists: true; bytes: number; sha256: string }>; remove(path: string): Promise<void> }
export const privateDisposalStorage: DisposalStorage = {
  async inspect(path) {
    const client = storageClient(), info = await client.storage.getBucket(EVIDENCE_BUCKET)
    if (info.error || !info.data || info.data.public || Number(info.data.file_size_limit) !== EVIDENCE_LIMIT || [...info.data.allowed_mime_types ?? []].sort().join() !== [...evidenceTypes].sort().join()) throw new BusinessError(503, "Private verification storage is not configured correctly.")
    const { data, error } = await client.storage.from(EVIDENCE_BUCKET).download(validEvidencePath(path))
    if (error) {
      const e = error as { status?: number; statusCode?: string | number }
      if (Number(e.statusCode ?? e.status) === 404) return { exists: false }
      throw new BusinessError(503, "Unable to confirm the original's storage state.")
    }
    if (!data || data.size > EVIDENCE_LIMIT) throw new BusinessError(503, "Unable to confirm the original's integrity.")
    const bytes = new Uint8Array(await data.arrayBuffer())
    return { exists: true, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
  },
  remove: path => privateEvidenceStorage.remove(path),
}
