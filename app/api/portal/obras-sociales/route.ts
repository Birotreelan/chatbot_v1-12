/**
 * Búsqueda de obras sociales para el selector del alta (23/9/2026).
 *
 * Desde el 17/11/2026 atiende dos cosas: con `q` busca por texto, y sin `q`
 * devuelve el catálogo completo para el select del alta.
 *
 * Es de sólo lectura y sobre un catálogo que la clínica publica igual, pero
 * igual exige un token vigente: sin eso sería un endpoint abierto que permite
 * enumerar los convenios de cualquier cliente pasando su `clienteId`. El
 * `clienteId` sale del token, nunca del query string.
 */

import { NextResponse } from "next/server"
import { leerEnlace } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import { buscarObrasSociales, catalogoDeObrasSociales } from "@/lib/portal/identidad"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token") || ""
  const busqueda = url.searchParams.get("q") || ""

  if (!token) return NextResponse.json({ ok: false, opciones: [] }, { status: 400 })

  const lectura = await leerEnlace(token)
  if (!lectura || !lectura.contexto.clienteId || !permiteGestionar(lectura.estado)) {
    /**
     * El rechazo deja constancia (24/11/2026).
     *
     * Para el formulario del alta, este 404 es indistinguible de "la clínica no
     * tiene catálogo": en los dos casos el campo vuelve a ser el de escribir.
     * Sin este log, la pantalla contaba un problema del token como si fuera un
     * problema del catálogo, y la investigación arrancaba en el lugar
     * equivocado. El token no se registra entero —es la credencial— sólo su
     * prefijo, que es con lo que se lo cruza con los otros logs del portal.
     */
    console.warn(
      `[PORTAL] Catálogo rechazado: ${
        !lectura
          ? "el enlace no existe o no se pudo leer"
          : !lectura.contexto.clienteId
            ? "el enlace no tiene clienteId"
            : `el enlace está en estado ${lectura.estado}`
      } (enlace ${token.slice(0, 8)}). El alta cae al campo de búsqueda por texto.`,
    )
    return NextResponse.json({ ok: false, opciones: [] }, { status: 404 })
  }

  /**
   * Sin `q` se pide el catálogo completo, para el select del alta (17/11/2026).
   *
   * Con `q` sigue siendo la búsqueda de antes, que es a lo que cae el campo si
   * el catálogo vuelve vacío. Las dos formas en la misma ruta y no en dos: es
   * la misma pregunta —"¿qué obras sociales tiene esta clínica?"— y el token
   * se valida igual en los dos casos.
   */
  const opciones = busqueda.trim()
    ? await buscarObrasSociales(lectura.contexto.clienteId, busqueda)
    : await catalogoDeObrasSociales(lectura.contexto.clienteId)

  return NextResponse.json({ ok: true, opciones, catalogo: !busqueda.trim() })
}
