import { notFound } from "next/navigation"
import { choiceKindSchema } from "@/modules/real-estate/choices"
import { PropertyChoiceEditor } from "@/modules/real-estate/components/choice-editor"
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind: input, id } = await params
  const kind = choiceKindSchema.safeParse(input)
  if (!kind.success) notFound()
  return <PropertyChoiceEditor kind={kind.data} id={id === "new" ? undefined : id} />
}
