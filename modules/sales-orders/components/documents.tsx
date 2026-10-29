"use client"
import { SourceDocuments } from "@/platform/documents/source-controls"
export function OrderDocuments({orderId}:{orderId:string}){
 return <SourceDocuments endpoint={`/api/sales-orders/${orderId}/documents`} permissionResource="orderDocuments"/>
}
