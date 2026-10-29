export async function sourceDocumentRequest<T>(url:string,init?:RequestInit):Promise<T>{
 const response=await fetch(url,{cache:"no-store",...init}),data=await response.json()
 if(!response.ok)throw new Error(data.error||"Unable to load this document.")
 return data
}
