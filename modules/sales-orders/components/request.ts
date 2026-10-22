export async function orderRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load the order.")
  return data
}
