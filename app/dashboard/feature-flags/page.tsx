import { FeatureFlagsPanel } from "@/components/dashboard/feature-flags-panel"

export default function FeatureFlagsPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Feature Flags</h1>
        <p className="text-muted-foreground mt-1">
          Activar o desactivar funcionalidades del backend de forma global. Los cambios aplican
          inmediatamente sin necesidad de deploy.
        </p>
      </div>
      <FeatureFlagsPanel />
    </div>
  )
}

export const dynamic = "force-dynamic"
