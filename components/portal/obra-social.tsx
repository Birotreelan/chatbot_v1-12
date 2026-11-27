"use client"

/**
 * Elegir la obra social (27/11/2026).
 *
 * Salió de `identificarse.tsx` cuando apareció el segundo usuario: la pantalla
 * donde el paciente CON ficha corrige su cobertura. No es una extracción por
 * prolijidad — adentro hay cinco comportamientos, cada uno con un caso real
 * detrás, y copiarlos habría dejado dos versiones que se separan en el primer
 * ajuste:
 *
 *  1. El catálogo se pide una sola vez al abrir la pantalla, no al desplegar.
 *  2. Un reintento si el pedido falla, porque un corte de un segundo en un
 *     teléfono degradaba el campo hasta una recarga que nadie hace.
 *  3. Si la clínica no publica el catálogo, se cae a buscar contra el proxy
 *     desde tres letras —no dos: con dos el proxy contesta "ninguna" y el
 *     paciente concluye que su obra social no está—.
 *  4. Con catálogo el filtro es local, por palabras en cualquier orden y sin
 *     acentos, y las que empiezan con lo escrito van primero.
 *  5. Las que no permiten turnos online se muestran IGUAL, marcadas. Ocultarlas
 *     dejaría al paciente de PAMI sin encontrar la suya, y terminaría eligiendo
 *     una parecida que no es la de él: llega a la clínica con la cobertura
 *     equivocada, que es peor que derivarlo al teléfono.
 *
 * El componente no sabe para qué se elige la obra social: avisa hacia arriba y
 * el formulario decide qué hacer. Por eso sirve igual para el alta y para la
 * corrección.
 */

import { useEffect, useMemo, useState } from "react"
import { Aviso } from "./marco"
import { CLASES_CAMPO, CLASES_OPCION, Campo, paraComparar } from "./campos"

export interface ObraSocial {
  id: string
  nombre: string
  permiteOnline: boolean
}

/**
 * Tres letras, no dos (17/11/2026).
 *
 * Verificado contra el proxy de Clínica de Ojos: `get_obras_sociales` con "osd"
 * devuelve OSDE y con "os" devuelve la lista vacía. O sea que exige tres
 * caracteres y abajo de eso no avisa nada: contesta "ninguna".
 *
 * Buscando desde dos, el paciente que tipeaba exactamente dos letras veía una
 * lista vacía y concluía que su obra social no estaba. Pedir una letra más es
 * mejor que mentirle.
 */
const MINIMO_PARA_BUSCAR = 3

export function CampoDeObraSocial({
  token,
  etiqueta,
  error,
  inicial,
  onCambio,
}: {
  token: string
  etiqueta: string
  error?: string
  /** Lo ya elegido, cuando el paciente vuelve a esta pantalla. */
  inicial?: { id?: string; nombre?: string } | null
  /** `null` cuando el paciente deshace la elección. */
  onCambio: (elegida: ObraSocial | null) => void
}) {
  const [busqueda, setBusqueda] = useState("")
  const [opcionesRemotas, setOpcionesRemotas] = useState<ObraSocial[]>([])
  /**
   * `null` mientras se está pidiendo, `[]` si el proxy no lo devolvió. Son dos
   * estados distintos y se ven distinto: "cargando" no puede verse igual que
   * "no hay ninguna", porque en el segundo caso hay que ofrecerle al paciente
   * la otra forma de completarlo.
   */
  const [catalogo, setCatalogo] = useState<ObraSocial[] | null>(null)
  const [elegida, setElegidaLocal] = useState<ObraSocial | null>(
    inicial?.id && inicial?.nombre
      ? {
          id: inicial.id,
          nombre: inicial.nombre,
          // La que ya estaba guardada pasó el chequeo del servidor cuando se
          // guardó; si estuviera bloqueada, el paciente no habría llegado acá.
          permiteOnline: true,
        }
      : null,
  )

  function elegir(os: ObraSocial | null) {
    setElegidaLocal(os)
    onCambio(os)
  }

  const hayCatalogo = Array.isArray(catalogo) && catalogo.length > 0

  useEffect(() => {
    let vigente = true
    ;(async () => {
      /**
       * Un reintento, no cero (24/11/2026).
       *
       * El pedido se hace una sola vez en toda la pantalla, y si falla el campo
       * se degrada hasta que el paciente recargue —cosa que no va a hacer,
       * porque el campo de escribir funciona y no parece roto—. Un corte de red
       * de un segundo en un teléfono alcanzaba para perder la lista.
       *
       * Uno solo y con una espera corta: si el proxy de la clínica no publica
       * el catálogo, insistir no lo va a cambiar y el paciente está esperando.
       */
      for (let intento = 1; intento <= 2; intento++) {
        try {
          const r = await fetch(`/api/portal/obras-sociales?token=${encodeURIComponent(token)}`)
          const data = await r.json()
          if (!vigente) return
          const opciones = Array.isArray(data?.opciones) ? data.opciones : []
          if (opciones.length > 0 || intento === 2) {
            setCatalogo(opciones)
            return
          }
        } catch {
          if (!vigente) return
          if (intento === 2) {
            // Queda en `[]`: el campo vuelve a ser el de escribir, que funciona.
            setCatalogo([])
            return
          }
        }
        await new Promise((listo) => setTimeout(listo, 700))
        if (!vigente) return
      }
    })()
    return () => {
      vigente = false
    }
  }, [token])

  /**
   * El catálogo, filtrado con lo que el paciente escribe.
   *
   * Local: el catálogo ya está en memoria, así que responde en el mismo golpe
   * de tecla, sin un pedido por letra ni la lista parpadeando mientras llega.
   *
   * Todas las palabras en cualquier orden: "medical swiss" encuentra "SWISS
   * MEDICAL SA". Pedir el orden exacto es volver al problema que la lista vino
   * a resolver, que es tener que acordarse de cómo está escrita la propia obra
   * social.
   *
   * Las que EMPIEZAN con lo escrito van primero. Con "os" la lista alfabética
   * arranca en "DOSUBA" y "OSDE" queda a veinte filas de distancia.
   */
  const filtradas = useMemo(() => {
    if (!catalogo) return []
    const buscado = paraComparar(busqueda)
    if (!buscado) return catalogo

    const palabras = buscado.split(/\s+/)
    return catalogo
      .filter((os) => {
        const nombre = paraComparar(os.nombre)
        return palabras.every((palabra) => nombre.includes(palabra))
      })
      .sort(
        (a, b) =>
          (paraComparar(a.nombre).startsWith(buscado) ? 0 : 1) -
          (paraComparar(b.nombre).startsWith(buscado) ? 0 : 1),
      )
  }, [catalogo, busqueda])

  async function buscar(texto: string) {
    setBusqueda(texto)
    elegir(null)
    // Con catálogo el filtrado es local —`filtradas`— y no hay nada que pedir.
    if (hayCatalogo) return
    if (texto.trim().length < MINIMO_PARA_BUSCAR) {
      setOpcionesRemotas([])
      return
    }
    try {
      const r = await fetch(
        `/api/portal/obras-sociales?token=${encodeURIComponent(token)}&q=${encodeURIComponent(texto)}`,
      )
      const data = await r.json()
      setOpcionesRemotas(Array.isArray(data.opciones) ? data.opciones : [])
    } catch {
      setOpcionesRemotas([])
    }
  }

  return (
    <>
      {/* ── Elegida vs. escrita ──────────────────────────────────────────────
          Hasta el 9/10/2026 los dos estados se veían IGUAL: un input con el
          texto adentro. El paciente escribía "osde", no tocaba la opción, y
          continuaba convencido de haber elegido — pero la elección seguía en
          null y el turno se reservaba sin `Deudor_Id`.

          Ahora la elección se ve como tal: deja de ser un campo de texto y
          pasa a ser el nombre confirmado con un botón para cambiarlo. */}
      <Campo etiqueta={etiqueta} error={error}>
        {elegida ? (
          <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
            <span className="text-[15px] font-medium sm:text-base">{elegida.nombre}</span>
            <button
              type="button"
              className="shrink-0 text-[14px] text-primary underline underline-offset-2"
              onClick={() => {
                elegir(null)
                setBusqueda("")
                setOpcionesRemotas([])
              }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <input
            autoComplete="off"
            value={busqueda}
            onChange={(e) => buscar(e.target.value)}
            placeholder={
              catalogo === null
                ? "Cargando las obras sociales…"
                : hayCatalogo
                  ? "Buscá la tuya o elegila de la lista"
                  : "Escribí al menos 3 letras del nombre"
            }
            className={CLASES_CAMPO}
          />
        )}
      </Campo>

      {/* El recuadro con scroll y no la lista entera: 243 filas sueltas
          empujan el botón "Continuar" fuera de cualquier pantalla, y el
          paciente que no sabe que hay un botón ahí abajo no llega nunca. */}
      {hayCatalogo && !elegida && (
        <div className="-mt-2 max-h-72 overflow-y-auto rounded-xl border border-input bg-background p-1.5">
          {filtradas.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-muted-foreground">
              No encontramos ninguna obra social con «{busqueda.trim()}». Probá con otra parte del
              nombre, sin siglas ni puntos.
            </p>
          ) : (
            filtradas.map((os) => (
              <button
                key={os.id}
                type="button"
                onClick={() => {
                  elegir(os)
                  setBusqueda("")
                }}
                className={CLASES_OPCION}
              >
                {os.nombre}
                {!os.permiteOnline && (
                  <span className="mt-0.5 block text-[13px] text-warning">
                    Con esta obra social el turno se saca por teléfono
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Cuántas quedaron, sólo mientras el filtro está puesto. El que escribe
          tres letras y ve cuatro filas no sabe si la lista se filtró o si la
          clínica tiene cuatro convenios. */}
      {hayCatalogo && !elegida && busqueda.trim() && filtradas.length > 0 && (
        <p className="-mt-2 text-[13px] text-muted-foreground">
          {filtradas.length} de {catalogo!.length} obras sociales. Tocá la tuya para elegirla.
        </p>
      )}

      {/* Se dice qué falta hacer mientras la lista está abierta. Sin esto, la
          lista parece un autocompletado decorativo. */}
      {!hayCatalogo && !elegida && busqueda.trim().length >= MINIMO_PARA_BUSCAR && opcionesRemotas.length > 0 && (
        <p className="-mt-2 text-[13px] text-muted-foreground">Tocá la tuya para elegirla:</p>
      )}

      {/* Y cuando no hay ninguna, también se dice (17/11/2026). Antes, una
          búsqueda sin resultados no mostraba nada: el paciente escribía, no
          pasaba nada, y no sabía si el campo estaba roto, si tenía que seguir
          escribiendo o si su obra social no figuraba. */}
      {!hayCatalogo && !elegida && busqueda.trim().length >= MINIMO_PARA_BUSCAR && opcionesRemotas.length === 0 && (
        <p className="-mt-2 text-[13px] text-muted-foreground">
          No encontramos ninguna obra social con «{busqueda.trim()}». Probá con otra parte del
          nombre, sin siglas ni puntos.
        </p>
      )}

      {!hayCatalogo && !elegida && opcionesRemotas.length > 0 && (
        <div className="-mt-2 space-y-2">
          {opcionesRemotas.map((os) => (
            <button
              key={os.id}
              type="button"
              onClick={() => {
                elegir(os)
                setOpcionesRemotas([])
              }}
              className={`${CLASES_OPCION} border bg-card`}
            >
              {os.nombre}
              {!os.permiteOnline && (
                <span className="mt-0.5 block text-[13px] text-warning">
                  Con esta obra social el turno se saca por teléfono
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {elegida && !elegida.permiteOnline && (
        <Aviso
          titulo={`Los turnos de ${elegida.nombre} se gestionan por teléfono`}
          detalle="Si continuás, te vamos a pasar el contacto de la clínica."
          tono="atencion"
        />
      )}
    </>
  )
}
