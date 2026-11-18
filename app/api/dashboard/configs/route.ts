import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { estadoDePausa, type EstadoDePausa } from "@/lib/pausa-de-envios"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Esta devolvía `...config` entero —accessToken de Meta, wabaId, phoneNumberId
 * y la URL del proxy de cada clínica— sin pedir nada. Con eso se puede mandar
 * WhatsApp en nombre de cualquier clínica. `/api/configs` devuelve lo mismo y
 * exige super admin desde siempre: esta era la segunda puerta a la misma
 * habitación, sin cerradura.
 *
 * Se protegen sólo las lecturas críticas —credenciales, conversaciones de
 * pacientes, datos personales y comerciales—. Las estadísticas agregadas
 * quedan abiertas a propósito: no identifican a nadie.
 *
 * La consumen pantallas del dashboard desde el navegador, que mandan la
 * cookie de sesión sola: no hubo que tocar ningún `fetch`.
 */
export async function GET() {
  // Lectura crítica: exige sesión. Ver la nota de arriba.
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }

  try {
    const configs = await getAllWhatsAppConfigs()

    // ── El estado real de la pausa (1/10/2026) ────────────────────────────
    //
    // La lista mostraba el badge "IA Pausada" leyendo `config.paused`, un campo
    // que nadie escribía del lado del servidor: al recargar la página el badge
    // volvía a su valor viejo y no tenía relación con lo que el motor hacía.
    //
    // Ahora el estado sale de donde la compuerta lo lee, que es la única
    // fuente que importa. Se agrega como campo aparte y no pisando `paused`
    // para no mezclar la pausa por conversación con la del cliente entero.
    const estados = await Promise.all(
      configs.map((c): Promise<EstadoDePausa> =>
        c.phoneNumberId ? estadoDePausa(c.phoneNumberId) : Promise.resolve({ pausado: false }),
      ),
    )

    return NextResponse.json(
      configs.map((config, i) => ({
        ...config,
        enviosPausados: estados[i].pausado,
        enviosPausadosDesde: estados[i].desde,
      })),
    )
  } catch (error) {
    console.error("Error al obtener configuraciones:", error)
    return NextResponse.json([], { status: 500 })
  }
}
