export const LOGO_UPLOAD_LIMIT = 2 * 1024 * 1024
export const LOGO_STORED_LIMIT = 512 * 1024
export type LogoAsset = { path: string; width: number; height: number; bytes: number }
export type TenantBranding = { name?: string; logo?: { document: LogoAsset; sidebar: LogoAsset } }
export type DocumentBranding = { name: string; logo: LogoAsset | null }
export type BrandingState = { branding: TenantBranding; version: number; defaultName: string; canManage: boolean; logoUrl: string | null; storageReady: boolean }
