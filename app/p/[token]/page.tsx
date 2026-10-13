/**
 * app/p/[token]/page.tsx — el enlace en formato de pantallas.
 *
 * Toda la lógica vive en components/portal/pagina-del-enlace.tsx, compartida
 * con /c/[token]. Esta ruta sólo fija el formato.
 */

import { PaginaDelEnlace } from "@/components/portal/pagina-del-enlace"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** El portal no se indexa: cada URL es de un paciente. */
export const metadata = {
  robots: { index: false, follow: false },
  title: "Gestión de turnos",
}

export default async function PaginaDelPortal({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  // Se invoca como función y no como JSX a propósito: el TypeScript de este
  // proyecto todavía no acepta un componente servidor `async` dentro de JSX
  // —ver el mismo error en app/widget-form/page.tsx— y envolverlo sumaría un
  // error al typecheck para no ganar nada.
  return PaginaDelEnlace({ params, searchParams, formato: "pantallas" })
}
