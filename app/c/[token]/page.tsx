/**
 * app/c/[token]/page.tsx — el enlace en formato de chat.
 *
 * A diferencia de /p/[token], esto NO comparte la máquina de pasos del portal:
 * corre el motor conversacional, el mismo que corre el bot en WhatsApp. Lo
 * único compartido son las guardas de vigencia del enlace
 * (`components/portal/pantalla-terminal.tsx`), que tienen que contestar igual
 * en los dos formatos.
 *
 * Ver `components/enlace/pagina-del-chat.tsx`.
 *
 * No recibe `searchParams`: en el chat el estado no viaja en la URL —lo tiene
 * el motor, contra la clave `web_<token>`—, así que no hay filtros que leer.
 */

import { PaginaDelChat } from "@/components/enlace/pagina-del-chat"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** No se indexa, por el mismo motivo que /p/: cada URL es de un paciente. */
export const metadata = {
  robots: { index: false, follow: false },
  title: "Gestión de turnos",
}

export default async function PaginaDelChatbot({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  // Como función y no como JSX: ver la nota en app/p/[token]/page.tsx.
  return PaginaDelChat({ params })
}
