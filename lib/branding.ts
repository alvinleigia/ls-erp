export const APPLICATION_NAME = "Leiweissen ERP"
export const APPLICATION_ID = "ls-erp"

export function businessDisplayName(name?: string | null) {
  return name?.trim() || APPLICATION_NAME
}

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}
