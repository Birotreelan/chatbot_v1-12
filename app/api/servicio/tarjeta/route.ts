/**
 * Los resúmenes de tarjeta y la conciliación con lo computado.
 *
 * GET    · los resúmenes cargados y la cuenta corriente hasta el mes pedido
 * POST   · analiza un texto pegado; guarda sólo si se lo pide explícitamente
 * DELETE · borra un resumen por su fecha de cierre
 *
 * ── Analizar y guardar son dos pasos, a propósito ──────────────────────────
 *
 * El POST con `guardar: false` devuelve lo que entendió del texto y no toca
 * nada. La pantalla lo muestra —las líneas, los impuestos, las verificaciones—
 * y recién entonces se guarda. Un resumen mal cargado desbalancea una cuenta
 * que tiene que cerrar al centavo, así que la persona tiene que poder ver el
 * detalle antes de confirmarlo.
 *
 * Y si alguna verificación falla, no se guarda ni pidiéndolo: ver `problemas`
 * en lib/tarjeta-resumen.ts.
 */

import { NextResponse } from "next/server"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import { analizarResumen, totalesDelResumen, type LineaDelResumen } from "@/lib/tarjeta-resumen"
import {
  borrarResumen,
  guardarResumen,
  listarResumenes,
  periodoDelCierre,
  type ResumenGuardado,
} from "@/lib/servicio-tarjeta"
import { conciliar, type MesComputado } from "@/lib/servicio-conciliacion"
import { leerResumenDelPDF, MAXIMO_PDF_BYTES } from "@/lib/tarjeta-resumen-ia"
import { COSTO_DESGLOSADO_DESDE } from "@/lib/servicio-costos"
import { mensajesConCargoDelPeriodo } from "@/lib/facturacion-cierre"

export const dynamic = "force-dynamic"

function periodoValido(periodo: unknown): periodo is string {
  return typeof periodo === "string" && /^\d{4}-\d{2}$/.test(periodo)
}

/** Los meses desde que hay desglose hasta el pedido, inclusive. */
function mesesHasta(hasta: string): string[] {
  const meses: string[] = []
  let [anio, mes] = COSTO_DESGLOSADO_DESDE.split("-").map(Number)
  for (let i = 0; i < 240; i++) {
    const actual = `${anio}-${String(mes).padStart(2, "0")}`
    if (actual > hasta) break
    meses.push(actual)
    mes += 1
    if (mes > 12) {
      mes = 1
      anio += 1
    }
  }
  return meses
}

export async function GET(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const params = new URL(request.url).searchParams
    const hasta = params.get("hasta")
    if (!periodoValido(hasta)) {
      return NextResponse.json({ error: "hasta debe tener el formato YYYY-MM" }, { status: 400 })
    }

    /**
     * Los mensajes del mes que se está mirando los manda la pantalla.
     *
     * Es el mismo número que muestra la fila "Total general de todo", y usarlo
     * acá es lo que hace que la conciliación no pueda contradecir a la tabla
     * que tiene arriba. El mes en curso además no tiene cierre, así que el
     * servidor no lo tendría de ninguna otra forma.
     */
    const delaPantalla = params.get("mensajes")
    const mensajesDeLaPantalla =
      delaPantalla !== null && delaPantalla !== "" && Number.isFinite(Number(delaPantalla))
        ? Math.round(Number(delaPantalla))
        : null

    const periodos = mesesHasta(hasta)
    const meses: MesComputado[] = await Promise.all(
      periodos.map(async (periodo) => {
        if (periodo === hasta && mensajesDeLaPantalla !== null) {
          return { periodo, mensajesConCargo: mensajesDeLaPantalla }
        }
        return { periodo, mensajesConCargo: await mensajesConCargoDelPeriodo(periodo) }
      }),
    )

    const resumenes = await listarResumenes()
    const conciliacion = conciliar(meses, resumenes)

    return NextResponse.json({ exito: true, hasta, resumenes, conciliacion })
  } catch (error) {
    console.error("[SERVICIO_TARJETA] Error leyendo:", error)
    return NextResponse.json({ error: "Error al obtener los resúmenes" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    /**
     * Dos formas de cargar el mismo resumen (2/11/2026).
     *
     * · PDF (multipart): lo lee un modelo. Es el camino recomendado, porque al
     *   copiar un PDF el visor entrega las columnas una abajo de la otra y las
     *   filas dejan de existir — ninguna regla puede reconstruirlas.
     * · texto pegado (JSON): el parser determinístico, que sirve cuando el
     *   texto viene alineado.
     *
     * Las dos desembocan en el MISMO `ResumenAnalizado`, con las mismas
     * verificaciones. Lo que decide si un resumen se guarda no depende de cómo
     * se extrajo. Ver lib/tarjeta-resumen-ia.ts.
     */
    const tipo = request.headers.get("content-type") || ""
    let analisis: Awaited<ReturnType<typeof leerResumenDelPDF>> | ReturnType<typeof analizarResumen>
    let body: any = null
    let leidoConIA = false

    if (tipo.includes("multipart/form-data")) {
      const form = await request.formData()
      const archivo = form.get("archivo")
      if (!(archivo instanceof File)) {
        return NextResponse.json({ error: "Falta el archivo PDF." }, { status: 400 })
      }
      if (archivo.size > MAXIMO_PDF_BYTES) {
        return NextResponse.json(
          { error: `El PDF pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 10 MB.` },
          { status: 400 },
        )
      }
      // El resto de los campos viajan como texto en el mismo form.
      body = {
        guardar: form.get("guardar") === "1" || form.get("guardar") === "true",
        periodoImputado: form.get("periodoImputado") || undefined,
        nota: form.get("nota") || undefined,
        categorias: form.get("categorias") ? JSON.parse(String(form.get("categorias"))) : {},
      }
      try {
        analisis = await leerResumenDelPDF(
          Buffer.from(await archivo.arrayBuffer()),
          archivo.name || "resumen.pdf",
        )
        leidoConIA = true
      } catch (err) {
        console.error("[SERVICIO_TARJETA] No se pudo leer el PDF:", err)
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? `No se pudo leer el PDF: ${err.message}`
                : "No se pudo leer el PDF.",
          },
          { status: 422 },
        )
      }
    } else {
      body = await request.json().catch(() => null)
      const texto = typeof body?.texto === "string" ? body.texto : ""
      if (texto.trim().length < 50) {
        return NextResponse.json(
          { error: "Subí el PDF o pegá el texto del resumen: lo que llegó es demasiado corto." },
          { status: 400 },
        )
      }
      analisis = analizarResumen(texto)
    }

    /**
     * Las correcciones de categoría que hizo la persona.
     *
     * Los descriptores de Meta son opacos —`FACEBK *9WRQ646BJ4` no dice si es
     * mensajería o publicidad— así que la clasificación automática es un
     * default y esto la corrige por cupón. Sin cupón se usa la posición.
     */
    const correcciones: Record<string, "meta" | "otro"> =
      body?.categorias && typeof body.categorias === "object" ? body.categorias : {}

    const lineas: LineaDelResumen[] = analisis.lineas.map((l, i) => {
      const correccion = correcciones[l.cupon ?? `#${i}`]
      return correccion === "meta" || correccion === "otro" ? { ...l, categoria: correccion } : l
    })

    // Recalculado con las correcciones aplicadas: si una línea cambió de
    // categoría, el tipo de cambio por la base del IVA cambia, y por lo tanto
    // también las verificaciones. Se vuelve a analizar en vez de parchear.
    const conCorrecciones = { ...analisis, lineas }
    const totales = totalesDelResumen(conCorrecciones)

    if (!body?.guardar) {
      return NextResponse.json({ exito: true, analisis: conCorrecciones, totales, leidoConIA })
    }

    if (analisis.problemas.length > 0) {
      return NextResponse.json(
        {
          error: "El resumen no pasó las verificaciones, así que no se guardó.",
          problemas: analisis.problemas,
          analisis: conCorrecciones,
          totales,
        },
        { status: 422 },
      )
    }
    if (!analisis.cierre) {
      return NextResponse.json({ error: "No encontré la fecha de cierre." }, { status: 422 })
    }

    const periodoImputado = periodoValido(body?.periodoImputado)
      ? body.periodoImputado
      : periodoDelCierre(analisis.cierre)

    const resumen: ResumenGuardado = {
      cierre: analisis.cierre,
      cierreAnterior: analisis.cierreAnterior,
      vencimiento: analisis.vencimiento,
      periodoImputado,
      tipoDeCambio: analisis.tipoDeCambio,
      cargosDeMetaUSD: totales.cargosDeMetaUSD,
      cargosFijosUSD: totales.cargosFijosUSD,
      impuestosARS: totales.impuestosARS,
      impuestosUSD: totales.impuestosUSD,
      percepcionDebitadaARS: totales.percepcionDebitadaARS,
      percepcionAcreditadaARS: totales.percepcionAcreditadaARS,
      lineas,
      impuestos: analisis.impuestos,
      cargadoEl: new Date().toISOString(),
      nota: typeof body?.nota === "string" ? body.nota.trim().slice(0, 300) : undefined,
    }

    await guardarResumen(resumen)
    console.log(
      `[SERVICIO_TARJETA] Resumen ${resumen.cierre} guardado e imputado a ${periodoImputado}: ` +
        `Meta US$ ${resumen.cargosDeMetaUSD.toFixed(2)}, fijos US$ ${resumen.cargosFijosUSD.toFixed(2)}`,
    )

    return NextResponse.json({
      exito: true,
      guardado: resumen,
      analisis: conCorrecciones,
      totales,
      leidoConIA,
    })
  } catch (error) {
    console.error("[SERVICIO_TARJETA] Error analizando o guardando:", error)
    return NextResponse.json({ error: "Error al procesar el resumen" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const cierre = new URL(request.url).searchParams.get("cierre")
    if (!cierre || !/^\d{4}-\d{2}-\d{2}$/.test(cierre)) {
      return NextResponse.json({ error: "cierre debe tener el formato YYYY-MM-DD" }, { status: 400 })
    }

    await borrarResumen(cierre)
    console.log(`[SERVICIO_TARJETA] Resumen ${cierre} borrado`)
    return NextResponse.json({ exito: true, cierre })
  } catch (error) {
    console.error("[SERVICIO_TARJETA] Error borrando:", error)
    return NextResponse.json({ error: "Error al borrar el resumen" }, { status: 500 })
  }
}
