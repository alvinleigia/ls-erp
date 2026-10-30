import { BusinessError } from '@/platform/policy'
export function taxPreparationError(error:unknown){
 const fault=error as {cause?:{originalMessage?:string};meta?:{driverAdapterError?:{cause?:{originalMessage?:string}}}}
 const message=fault?.cause?.originalMessage||fault?.meta?.driverAdapterError?.cause?.originalMessage
 return message?.startsWith('Tax preparation:')?new BusinessError(409,message):undefined
}
