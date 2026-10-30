import { formatDecimalCurrency } from '@/lib/formatting'

// Preserve exact values while removing storage-scale zeroes from displayed shares.
export const billingDecimal=(value:string)=>value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value
export const billingMoney=(value:string,currency:string,settings?:Parameters<typeof formatDecimalCurrency>[2])=>formatDecimalCurrency(billingDecimal(value),currency,settings)
