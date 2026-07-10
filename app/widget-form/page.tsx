import type React from "react"
import WidgetForm from "@/components/widget-form"

interface WidgetFormPageProps {
  searchParams: Promise<{
    clienteId: string
    embedded?: string
  }>
}

/**
 * Página del widget de FORMULARIO (tercer tipo de widget embebible, 9/7/2026).
 * Hermana de app/widget/page.tsx — misma convención de query params
 * (`clienteId`, `embedded`), pensada para vivir dentro de un iframe igual que
 * el widget de chat.
 */
const WidgetFormPage: React.FC<WidgetFormPageProps> = async ({ searchParams }) => {
  const params = await searchParams
  const { clienteId } = params

  return (
    <div>
      <WidgetForm clienteId={clienteId} hideHeader={false} />
    </div>
  )
}

export default WidgetFormPage
