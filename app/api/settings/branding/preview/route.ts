import { withBusinessApi } from "@/platform/business-api"
import { requireBrandingEdit } from "@/platform/branding/service"
import { brandingForm } from "@/platform/branding/request"
import { optimizeLogo } from "@/platform/branding/images"
import { BusinessError } from "@/platform/policy"
export const runtime = "nodejs"
export function POST(request: Request) { return withBusinessApi(request, async actor => {
  requireBrandingEdit(actor)
  const { file } = await brandingForm(request)
  if (!file) throw new BusinessError(400, "Choose a logo.")
  const result = await optimizeLogo(file)
  return { preview: `data:image/png;base64,${result.document.data.toString("base64")}`, width: result.document.info.width, height: result.document.info.height,
    bytes: result.document.data.length, sidebarBytes: result.sidebar.data.length, warning: result.warning }
}) }
