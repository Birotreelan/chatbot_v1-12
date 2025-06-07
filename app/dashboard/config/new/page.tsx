import { WhatsAppConfigForm } from "@/components/dashboard/whatsapp-config-form"

export default function NewWhatsAppConfigPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Nueva Configuración de WhatsApp</h1>
      <WhatsAppConfigForm />
    </div>
  )
}

// Desactivamos la generación estática para esta página
export const dynamic = "force-dynamic"
