"use client"
import * as React from "react"
import type { RecordOffice } from "@/types/companies"

export function InventoryCreationOffice({headers,resource}:{headers:()=>Promise<Record<string,string>>;resource:"inventoryProducts"|"inventoryPurchases"}) {
  const [office,setOffice]=React.useState<RecordOffice|null>(null)
  const [loading,setLoading]=React.useState(true)
  React.useEffect(()=>{
    const controller=new AbortController()
    void (async()=>{
      try{
        const captured=await headers(),id=captured["x-office-id"]
        if(!id)return
        const response=await fetch(`/api/inventory/office-choices?resource=${resource}&selected=${encodeURIComponent(id)}`,{signal:controller.signal,cache:"no-store"})
        if(!response.ok)throw Error("Office unavailable")
        const data=await response.json()
        if(!controller.signal.aborted)setOffice(data.selected)
      }catch{if(!controller.signal.aborted)setOffice(null)}finally{if(!controller.signal.aborted)setLoading(false)}
    })()
    return ()=>controller.abort()
  },[headers,resource])
  return <p className="mb-4 text-sm text-muted-foreground">{loading?"Loading stock office…":office?`Stock office: ${office.companyName} / ${office.name}${office.active?"":" (Closed)"}`:"Select a workspace office and reopen this form."}</p>
}
