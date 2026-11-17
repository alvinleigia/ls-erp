// Browser-only transfer of the selected bytes. Consumers retain reservation,
// authentication, validation and business-success handling.
export function uploadFileWithProgress(url: string, file: File, headers: Record<string, string>, progress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const failed = () => reject(new Error("The upload failed. Select the file again or cancel its pending upload."))
    request.open("PUT", url)
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)
    request.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) progress(Math.min(100, Math.max(0, Math.round(event.loaded / event.total * 100))))
    }
    request.onload = () => { if (request.status >= 200 && request.status < 300) { progress(100); resolve() } else failed() }
    request.onerror = failed; request.onabort = failed; request.ontimeout = failed
    progress(0)
    request.send(file)
  })
}
