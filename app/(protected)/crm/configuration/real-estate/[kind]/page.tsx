import { notFound } from "next/navigation"
import { choiceKindSchema } from "@/modules/real-estate/choices"
import { PropertyChoiceList } from "@/modules/real-estate/components/choice-list"
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const kind = choiceKindSchema.safeParse((await params).kind)
  if (!kind.success) notFound()
  return <PropertyChoiceList kind={kind.data} />
}
