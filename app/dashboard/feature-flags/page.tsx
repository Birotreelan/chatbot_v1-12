import { FeatureFlagsManager } from "@/components/dashboard/feature-flags-manager"

export default function FeatureFlagsPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Feature Flags</h1>
        <p className="text-muted-foreground mt-2">
          Activá o desactivá comportamientos del bot para TODOS los clientes, sin pasar por un deploy. Los cambios
          se guardan en Redis y toman efecto en los próximos mensajes (hasta 5 segundos de caché).
        </p>
      </div>
      <FeatureFlagsManager />
    </div>
  )
}

export const dynamic = "force-dynamic"
