import { WhatsAppConfigFormWrapper } from "@/components/dashboard/whatsapp-config-form-wrapper"

export default function NewConfigPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Nueva Configuración</h1>
        <p className="text-gray-600">Crea una nueva configuración de WhatsApp Bot</p>
      </div>

      <WhatsAppConfigFormWrapper isNew={true} />
    </div>
  )
}
