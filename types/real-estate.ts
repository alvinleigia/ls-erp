import type { FieldView } from "@/platform/custom-fields/validation"

export type Project = {
  customFields?: FieldView[];
  id: string; name: string; code: string; parentId: string | null; developerAccountId: string | null;
  location: string; description: string; categories: string[]; lifecycle: string; lifecycleName?: string; categoryNames?: Record<string, string>;
  priceMin: string | null; priceMax: string | null; currency: string | null; archived: boolean; version: number;
  canManage?: boolean; developerRestricted?: boolean; developerAccount?: { id: string; name: string } | null;
  parent?: { id: string; name: string; archived: boolean } | null;
}
export type PropertyContext = {
  projectId: string | null; subprojectId: string | null;
  budgetMin: string | null; budgetMax: string | null; budgetCurrency: string | null;
  propertyCategory: string | null; bedrooms: number | null; buyingTimeframe: string | null;
  propertyCategoryName?: string | null; buyingTimeframeName?: string | null;
  project?: { id: string; name: string; code: string; archived: boolean } | null;
  subproject?: { id: string; name: string; code: string; archived: boolean } | null;
}
