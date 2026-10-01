import { NextResponse } from "next/server"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { estadoDePausa, type EstadoDePausa } from "@/lib/pausa-de-envios"

export async function GET() {
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
