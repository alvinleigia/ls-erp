export const paymentMethodLabels:Record<string,string>={BANK_TRANSFER:'Bank transfer',UPI:'UPI',CARD:'Card',CASH:'Cash',CHEQUE:'Cheque',OTHER:'Other'}
export const transferTypeLabels:Record<string,string>={NEFT:'NEFT',RTGS:'RTGS',IMPS:'IMPS',WIRE:'Wire transfer',DD:'Demand draft'}
export function paymentMethodLabel(method:string,transferType:string){return transferTypeLabels[transferType]||paymentMethodLabels[method]||method}
