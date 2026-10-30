// Offline structural checks only. Passing these checks does not verify GSTN
// registration status, legal name, address or eligibility to issue a tax invoice.
const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export function gstinCheckDigit(first14:string){
 let sum=0
 for(let i=13;i>=0;i--){const product=alphabet.indexOf(first14[i])*(i%2===1?2:1);sum+=Math.floor(product/36)+product%36}
 return alphabet[(36-sum%36)%36]
}
export function validGstin(value:string){
 return /^(0[1-9]|[12][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)&&gstinCheckDigit(value.slice(0,14))===value[14]
}
