import { recordTerms } from "@/platform/terminology/catalog"
export const salesDocumentTerms = [
  ...recordTerms("salesDocuments", "Sales Documents", [["quotation", "Quotation", "Quotations"]]),
  ...recordTerms("paymentPlans", "Payment Plans", [["paymentPlan", "Payment plan", "Payment plans"]]),
]
