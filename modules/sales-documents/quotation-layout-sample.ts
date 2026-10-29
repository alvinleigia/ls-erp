import { emptyQuotationContent } from "./quotation-validation"
import { calculateQuotation } from "./quotation-calculation"
import type { QuotationSnapshot } from "./quotation-service"
import type { DocumentLayout } from "@/platform/documents/layout"

export function quotationLayoutSample(layout:DocumentLayout,paymentPlans=true):QuotationSnapshot {
  const content={...structuredClone(emptyQuotationContent),layout,title:"Sample quotation and payment plan",supplierName:"Sample Supplier",currency:"INR",lines:[{description:"Sample service or item",quantity:"1",unit:"each",rate:"100000"}],charges:[{label:"Sample pending charge",group:"",kind:"TBD" as const,value:"0",basis:"BASE" as const,included:false,due:"To be confirmed"}],instalments:[{label:"Booking",percent:"10",days:0,note:""},{label:"Balance",percent:"90",days:30,note:""}],bank:{accountName:"Sample Supplier",accountNumber:"0000000000",accountType:"Current",bankName:"Sample Bank",branch:"Sample branch",routingCode:"SAMPLE00000"},terms:"Sample approved terms. This preview contains example data."}
  if(!paymentPlans){content.instalments=[];content.title="Sample quotation"}
  return {content,calculation:calculateQuotation(content),customer:{name:"Sample Customer",email:"customer@example.test",phone:null},participants:{format:1,participants:[{role:"CUSTOMER",party:{kind:"PERSON",id:"sample-customer",name:"Sample Customer",email:"customer@example.test",phone:null,sourceVersion:1}},{role:"ADDITIONAL_CUSTOMER",party:{kind:"PERSON",id:"sample-additional",name:"Sample Additional Customer",email:null,phone:null,sourceVersion:1}}]},context:[{label:"Reference",value:"Sample reference"}],opportunity:"Sample opportunity",actor:"Sample author",template:null,locale:"en-IN",dateFormat:"yyyy-MM-dd",numberFormat:"US_UK",currencySymbolPlacement:"BEFORE"}
}
