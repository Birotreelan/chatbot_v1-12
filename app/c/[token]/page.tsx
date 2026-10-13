/**
 * app/c/[token]/page.tsx — el enlace en formato de chat.
 *
 * Misma lógica que /p/[token]: el token, las guardas de vigencia, la máquina de
 * pasos y las consultas a la agenda viven en
 * components/portal/pagina-del-enlace.tsx. Esta ruta sólo fija el formato.
 *
 * Lo que cambia es cómo se dibuja cada paso: en vez de una pantalla por paso,
 * una conversación donde el paso actual es la última burbuja y los anteriores
 * quedan arriba como historial.
 */

import { PaginaDelEnlace } from "@/components/portal/pagina-del-enlace"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** No se indexa, por el mismo motivo que /p/: cada URL es de un paciente. */
export const metadata = {
  robots: { index: false, follow: false },
  title: "Gestión de turnos",
}

export default async function PaginaDelChat({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  // Como función y no como JSX: ver la nota en app/p/[token]/page.tsx.
  return PaginaDelEnlace({ params, searchParams, formato: "chat" })
}
