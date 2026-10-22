import { withReceivablesApi } from "@/application/receivables/http"
export const GET = (request: Request) => withReceivablesApi(request, service => service.list(Object.fromEntries(new URL(request.url).searchParams)))
