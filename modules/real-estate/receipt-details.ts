import type { ReceiptDetailsAddon } from '@/modules/receivables/receipt-template'
import { propertyDocumentEvidenceSchema } from './document-evidence'
import { propertyDocumentFields,propertyDocumentValues } from './document-fields'

// These are the same accepted item facts exposed by the authorised order.
// Do not reconstruct a receipt from live project/catalogue names or prices.
export const realEstateReceiptDetails:ReceiptDetailsAddon={
 fields:propertyDocumentFields,
 sample(){return {rows:[{label:'Project',value:'Example Gardens'},{label:'Plot / unit',value:'106'},{label:'Area',value:'250 sq m'}],values:{'property.project-name':'Example Gardens','property.unit-number':'106','property.unit-code':'106','property.unit-name':'Example Plot 106','property.company-code':'','property.floor':'','property.area':'250','property.area-unit':'sq m','property.location':'Example City, Goa, India'}}},
 read(context){
  const units=(context.snapshot.items??[]).flatMap(ref=>{
   if(ref.documentEvidence?.key!=='realEstate')return []
   const parsed=propertyDocumentEvidenceSchema.safeParse(ref.documentEvidence.value)
   if(!parsed.success||parsed.data.tenantId!==context.order.tenantId||parsed.data.itemId!==ref.itemId)return []
   return [{ref,property:parsed.data}]
  })
  return {values:propertyDocumentValues(units),rows:units.map(({ref,property:p})=>({label:p.unitNumber?`${p.category} ${p.unitNumber}`:ref.displayName||ref.name,value:[(p.project.path?.map(node=>node.name)||[p.project.parent?.name,p.project.name]).filter(Boolean).join(' / '),p.area?`${p.area} ${p.areaUnit==='SQ_M'?'sq m':'sq ft'}`:'Area not supplied'].join(' | ')}))}
 }
}
