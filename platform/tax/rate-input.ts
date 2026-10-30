import { z } from 'zod'
import { decimalText, isDirectoryRate } from './arithmetic'

// Accept ordinary JSON numbers and exact strings, store/return one canonical
// decimal string. Never coerce an exact submitted string through Number().
export const taxRateInputSchema = z.union([z.string().trim().min(1).max(420), z.number().finite()])
  .refine(isDirectoryRate, 'Enter a rate from 0 to 100 with at most 12 decimal places.')
  .transform(value => decimalText(value))
