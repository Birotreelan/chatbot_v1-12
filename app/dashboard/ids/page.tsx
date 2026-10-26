import { IdsDeCliente } from "@/components/dashboard/ids-de-cliente"

/**
 * /dashboard/ids — los clientes partidos en dos `cliente_id` (26/10/2026).
 *
 * Vive dentro de /dashboard, cuyo layout exige `super_admin`: mover las
 * estadísticas y la facturación de una clínica entera no es una operación de
 * uso, es de mantenimiento.
 */
export default function DashboardIdsPage() {
  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">IDs de cliente</h1>
        <p className="text-muted-foreground mt-2">
          Cuando una clínica cambia de <code className="text-xs">cliente_id</code>, lo guardado bajo el id
          viejo deja de aparecer: la facturación le cobra cero y las estadísticas quedan vacías. Acá están
          los ids que tienen datos y ningún cliente reclama.
        </p>
      </div>
      <IdsDeCliente />
    </div>
  )
}

export const dynamic = "force-dynamic"
