"use client"

/**
 * Las dos pantallas en las que el paciente dice quién es (23/9/2026).
 *
 * ── Por qué estas SÍ llevan JavaScript ─────────────────────────────────────
 *
 * Los pasos de filtro son enlaces a propósito (ver `elegir-filtro.tsx`):
 * funcionan sin JS y el botón "atrás" hace lo esperable. Acá no se puede: los
 * datos son personales y no pueden viajar por la query string, así que hay que
 * mandarlos por POST. Lo que sí se conserva de aquel criterio es que el campo
 * mantenga lo escrito si algo falla — reescribir el DNI porque el servidor
 * tardó es la clase de fricción que hace abandonar.
 *
 * ── El orden: DNI, después el resto ────────────────────────────────────────
 *
 * Primero el DNI solo, porque la mayoría de los pacientes YA tienen ficha
 * aunque el bot no los haya reconocido por su teléfono (escribieron desde el
 * celular de un hijo, cambiaron de número, la clínica tiene otro cargado).
 * Para esos, pedirles nombre, apellido y email antes de buscar sería hacerlos
 * tipear cuatro campos que la clínica ya tiene.
 */

import { useRouter } from "next/navigation"
import { LoadingState } from "@/components/ui/loading-state"
import { useEffect, useMemo, useState } from "react"
import { Aviso, BotonPrimario } from "./marco"

// 16px o más en el campo: con menos, iOS hace zoom solo al enfocarlo y el
// paciente queda con la pantalla corrida.
const CLASES_CAMPO =
  "w-full rounded-xl border border-input bg-background px-4 py-3.5 text-base text-foreground sm:py-3 outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/**
 * Una fila tocable de la lista de obras sociales.
 *
 * Las dos listas —la del catálogo y la de la búsqueda contra el proxy— tienen
 * que verse iguales: es la misma acción, elegir una obra social, y que cambie
 * de aspecto según de dónde salió la lista no significa nada para el paciente.
 * Cada lista le agrega lo suyo: la del catálogo va dentro de un recuadro, así
 * que no lleva borde propio.
 */
const CLASES_OPCION =
  "min-h-[52px] w-full rounded-xl px-4 py-3 text-left text-[15px] transition-colors hover:bg-accent sm:min-h-[48px] sm:px-5 sm:text-base"

/**
 * Para comparar lo que el paciente escribe con el nombre de la obra social.
 *
 * Sin acentos y en minúscula porque nadie escribe "ASOCIACIÓN" con tilde en un
 * teclado de teléfono, y la lista de la clínica los usa de las dos maneras.
 */
function paraComparar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

function Campo({
  etiqueta,
  error,
  children,
}: {
  etiqueta: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{etiqueta}</span>
      {children}
      {error && (
        <span role="alert" className="mt-1.5 block text-sm text-destructive">
          {error}
        </span>
      )}
    </label>
  )
}

function Enviando({ children }: { children: React.ReactNode }) {
  return <LoadingState inline label={typeof children === "string" ? children : undefined} />
}

/** Paso 1: el DNI, solo. */
export function PedirDNI({
  token,
  paraFamiliar,
  valorInicial,
  ruta = "p",
  debug,
}: {
  /**
   * Volver con el panel de diagnóstico puesto (30/10/2026).
   *
   * El `replace` de acá abajo limpia la query a propósito, y eso se llevaba
   * puesto el `?debug=1`: justo después de identificarse —que es donde se
   * resuelve la obra social, o sea lo que uno vino a mirar— el panel
   * desaparecía.
   */
  debug?: boolean
  /** "p" o "c": a dónde volver después de guardar. Ver ElegirFiltro. */
  ruta?: string
  token: string
  /** El turno es para otra persona: el DNI que va es el de ella. */
  paraFamiliar?: boolean
  /**
   * Lo ya cargado, cuando el paciente volvió para corregirlo.
   *
   * Sin esto, "volver a corregir el DNI" sería volver a tipearlo entero — y el
   * que vuelve normalmente quiere cambiar un dígito.
   */
  valorInicial?: string
}) {
  const [dni, setDni] = useState(valorInicial || "")
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    try {
      const r = await fetch("/api/portal/identificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, accion: "dni", dni }),
      })
      const data = await r.json()
      if (data.ok) {
        // La página vuelve a decidir el paso con la identidad ya guardada, así
        // la lógica de "qué sigue" vive en un solo lugar (`decidirPaso`) y no
        // se duplica acá.
        //
        // `replace` + `refresh` y no `window.location.href` (28/9/2026): lo
        // segundo recargaba el documento entero. `replace` limpia los
        // parámetros de la URL —el `?paso=` con el que se llegó a corregir— y
        // `refresh` vuelve a pedir la página al servidor sin parpadeo. Van los
        // dos: si la URL ya estaba limpia, `replace` no hace nada y sin el
        // `refresh` la pantalla se quedaría igual.
        router.replace(`/${ruta}/${token}${debug ? "?debug=1" : ""}`)
        router.refresh()
        return
      }
      setError(data.errores?.dni || data.error || "No pudimos validar el DNI.")
      setCargando(false)
    } catch {
      setError("No pudimos conectarnos. Revisá tu señal y probá de nuevo.")
      // Sólo se apaga el "Validando…" cuando hay algo que corregir. En el
      // camino bueno NO se apaga: `router.refresh` tarda lo que tarde el
      // servidor, y devolver el botón a su estado normal en el medio deja la
      // pantalla quieta y sin explicación —que es justo lo que pasaba—.
      setCargando(false)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Campo etiqueta={paraFamiliar ? "DNI de la persona que se atiende" : "Número de DNI"}>
        <input
          // `inputMode="numeric"` abre el teclado numérico en el teléfono sin
          // rechazar un pegado con puntos: el servidor los saca igual.
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="30123456"
          className={CLASES_CAMPO}
        />
      </Campo>

      {error && <Aviso titulo="Revisá el DNI" detalle={error} tono="error" />}

      <BotonPrimario type="submit" deshabilitado={cargando}>
        {cargando ? <Enviando>Buscando…</Enviando> : "Continuar"}
      </BotonPrimario>
    </form>
  )
}

interface ObraSocial {
  id: string
  nombre: string
  permiteOnline: boolean
}

/** Paso 2: sólo para quien no tiene ficha. */
export function DarseDeAlta({
  token,
  dni,
  paraFamiliar,
  valoresIniciales,
  ruta = "p",
  debug,
}: {
  /** Ver PedirDNI: el `replace` limpia la query y se llevaba el `?debug=1`. */
  debug?: boolean
  /** "p" o "c": a dónde volver después de guardar. Ver ElegirFiltro. */
  ruta?: string
  token: string
  dni?: string
  /** Los datos son de la persona que se atiende, no de quien completa. */
  paraFamiliar?: boolean
  /** Lo ya cargado, cuando el paciente volvió a corregir algo. */
  valoresIniciales?: {
    nombre?: string
    apellido?: string
    email?: string
    obraSocialId?: string
    obraSocialNombre?: string
  }
}) {
  const [nombre, setNombre] = useState(valoresIniciales?.nombre || "")
  const [apellido, setApellido] = useState(valoresIniciales?.apellido || "")
  const [email, setEmail] = useState(valoresIniciales?.email || "")
  const [busquedaOS, setBusquedaOS] = useState("")
  const [opcionesOS, setOpcionesOS] = useState<ObraSocial[]>([])
  /**
   * El catálogo de la clínica, para el select (17/11/2026).
   *
   * `null` mientras se está pidiendo, `[]` si el proxy no lo devolvió. Son dos
   * estados distintos y se ven distinto: "cargando" no puede verse igual que
   * "no hay ninguna", porque en el segundo caso hay que ofrecerle al paciente
   * la otra forma de completarlo.
   */
  const [catalogo, setCatalogo] = useState<ObraSocial[] | null>(null)
  const [elegida, setElegida] = useState<ObraSocial | null>(
    valoresIniciales?.obraSocialId && valoresIniciales?.obraSocialNombre
      ? {
          id: valoresIniciales.obraSocialId,
          nombre: valoresIniciales.obraSocialNombre,
          // La que ya estaba guardada pasó el chequeo del servidor cuando se
          // guardó; si estuviera bloqueada, el paciente no habría llegado acá.
          permiteOnline: true,
        }
      : null,
  )
  const router = useRouter()
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(false)

  /** El select se usa cuando la clínica devolvió su catálogo. */
  const hayCatalogo = Array.isArray(catalogo) && catalogo.length > 0

  /**
   * Se pide una sola vez, al abrir la pantalla.
   *
   * Y no al desplegar el select: en un teléfono el desplegable se abre y se
   * cierra de un toque, y una lista que tarda en llenarse se lee como un
   * select vacío. Para cuando el paciente terminó de escribir su apellido,
   * su nombre y su email, esto ya está.
   */
  useEffect(() => {
    let vigente = true
    ;(async () => {
      /**
       * Un reintento, no cero (24/11/2026).
       *
       * El pedido se hace una sola vez en toda la pantalla, y si falla el campo
       * se degrada hasta que el paciente recargue —cosa que no va a hacer,
       * porque el campo de escribir funciona y no parece roto—. Un corte de red
       * de un segundo en un teléfono alcanzaba para perder el select.
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
   * Tres letras, no dos (17/11/2026).
   *
   * Verificado contra el proxy de Clínica de Ojos: `get_obras_sociales` con
   * "osd" devuelve OSDE y con "os" devuelve la lista vacía. O sea que exige
   * tres caracteres y abajo de eso no avisa nada: contesta "ninguna".
   *
   * Buscando desde dos, el paciente que tipeaba exactamente dos letras veía
   * una lista vacía y concluía que su obra social no estaba. Pedir una letra
   * más es mejor que mentirle.
   */
  const MINIMO_PARA_BUSCAR = 3

  /**
   * El catálogo, filtrado con lo que el paciente escribe (24/11/2026).
   *
   * ── Por qué el filtro y no sólo el desplegable ───────────────────────────
   *
   * Un `<select>` nativo con 243 convenios obliga a recorrer la lista entera
   * con el pulgar. En Android el desplegable del sistema no trae buscador —el
   * de iOS sí— así que la mitad de los pacientes quedaba haciendo scroll.
   *
   * ── Y por qué el filtro es local ─────────────────────────────────────────
   *
   * El catálogo ya está en memoria: filtrarlo acá responde en el mismo golpe de
   * tecla, sin un pedido por letra ni la lista parpadeando mientras llega. El
   * camino que consulta al proxy sigue existiendo para cuando la clínica no
   * publica el catálogo, y ahí sí cada búsqueda es un pedido.
   *
   * ── Todas las palabras, en cualquier orden ───────────────────────────────
   *
   * "medical swiss" encuentra "SWISS MEDICAL SA". Pedir el orden exacto es
   * volver al problema que el select vino a resolver: tener que acordarse de
   * cómo está escrita la propia obra social.
   *
   * Las que EMPIEZAN con lo escrito van primero. Con "os" la lista alfabética
   * arranca en "DOSUBA" y "OSDE" queda a veinte filas de distancia.
   */
  const filtradas = useMemo(() => {
    if (!catalogo) return []
    const buscado = paraComparar(busquedaOS)
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
  }, [catalogo, busquedaOS])

  async function buscarOS(texto: string) {
    setBusquedaOS(texto)
    setElegida(null)
    // Con catálogo el filtrado es local —`filtradas`— y no hay nada que pedir.
    if (hayCatalogo) return
    if (texto.trim().length < MINIMO_PARA_BUSCAR) {
      setOpcionesOS([])
      return
    }
    try {
      const r = await fetch(
        `/api/portal/obras-sociales?token=${encodeURIComponent(token)}&q=${encodeURIComponent(texto)}`,
      )
      const data = await r.json()
      setOpcionesOS(Array.isArray(data.opciones) ? data.opciones : [])
    } catch {
      setOpcionesOS([])
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()

    // ── La obra social, antes de salir (9/10/2026) ────────────────────────
    //
    // El servidor también la exige, pero el error tiene que verse ACÁ: el que
    // escribió "osde" y no tocó la opción de la lista no sabe que no eligió
    // nada — el campo muestra lo que tipeó, igual que si hubiera elegido.
    //
    // Por eso son dos mensajes distintos y no uno: "no escribiste nada" y
    // "escribiste pero no elegiste" se arreglan de maneras distintas, y el
    // segundo es el que estaba haciendo que los turnos se reservaran sin obra
    // social.
    //
    // Vale para los dos caminos. Con el `<select>` el caso no existía —o
    // elegía una opción o el campo quedaba en su valor inicial— pero desde que
    // el catálogo también se filtra escribiendo, el que tipea "osde" y aprieta
    // Continuar sin tocar la fila está otra vez en esta situación.
    if (!elegida) {
      setErrores({
        obraSocial: busquedaOS.trim()
          ? "Tocá tu obra social en la lista para elegirla."
          : hayCatalogo
            ? "Elegí tu obra social en la lista."
            : "Elegí tu obra social: escribí las primeras letras y tocala en la lista.",
      })
      return
    }

    setCargando(true)
    setErrores({})
    try {
      const r = await fetch("/api/portal/identificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accion: "alta",
          dni,
          nombre,
          apellido,
          email,
          obraSocialId: elegida?.id,
          obraSocialNombre: elegida?.nombre,
        }),
      })
      const data = await r.json()
      if (data.ok) {
        // Ver el comentario en PedirDNI: navegación del lado del cliente.
        router.replace(`/${ruta}/${token}${debug ? "?debug=1" : ""}`)
        router.refresh()
        return
      }
      setErrores(data.errores || { general: data.error || "Revisá los datos." })
      setCargando(false)
    } catch {
      setErrores({ general: "No pudimos conectarnos. Revisá tu señal y probá de nuevo." })
      // Ver la nota en PedirDNI: en el camino bueno el botón se queda
      // esperando hasta que la pantalla siguiente esté.
      setCargando(false)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Campo etiqueta={paraFamiliar ? "Apellido del paciente" : "Apellido"} error={errores.apellido}>
        <input
          // Para un familiar el navegador NO debe autocompletar con los datos
          // del titular del teléfono: sería exactamente el error a evitar.
          autoComplete={paraFamiliar ? "off" : "family-name"}
          autoFocus
          value={apellido}
          onChange={(e) => setApellido(e.target.value)}
          className={CLASES_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Nombre del paciente" : "Nombre"} error={errores.nombre}>
        <input
          autoComplete={paraFamiliar ? "off" : "given-name"}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className={CLASES_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Email de contacto" : "Email"} error={errores.email}>
        <input
          type="email"
          inputMode="email"
          autoComplete={paraFamiliar ? "off" : "email"}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@ejemplo.com"
          className={CLASES_CAMPO}
        />
      </Campo>

      {/* ── Elegida vs. escrita ──────────────────────────────────────────────
          Hasta el 9/10/2026 los dos estados se veían IGUAL: un input con el
          texto adentro. El paciente escribía "osde", no tocaba la opción, y
          continuaba convencido de haber elegido — pero `elegida` seguía en
          null y el turno se reservaba sin `Deudor_Id`.

          Ahora la elección se ve como tal: deja de ser un campo de texto y
          pasa a ser el nombre confirmado con un botón para cambiarlo. Es la
          diferencia entre pedirle al paciente que recuerde un paso y mostrarle
          en qué estado está. */}
      <Campo
        etiqueta={paraFamiliar ? "Obra social del paciente" : "Obra social"}
        error={errores.obraSocial}
      >
        {elegida ? (
          <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
            <span className="text-[15px] font-medium sm:text-base">{elegida.nombre}</span>
            <button
              type="button"
              className="shrink-0 text-[14px] text-primary underline underline-offset-2"
              onClick={() => {
                setElegida(null)
                setBusquedaOS("")
                setOpcionesOS([])
              }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <input
            autoComplete="off"
            value={busquedaOS}
            onChange={(e) => buscarOS(e.target.value)}
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

      {/* ── El catálogo: un campo igual al resto, con la lista abajo
             (24/11/2026) ──────────────────────────────────────────────────
          Era un `<select>` nativo. Dos problemas: con 243 convenios el
          desplegable de Android no trae buscador y hay que recorrerlo entero
          con el pulgar, y el campo se veía distinto del resto del formulario
          —el sistema operativo lo dibuja a su manera, con su flecha y su
          altura—.

          Ahora es el mismo input que Apellido, Nombre y Email, y la lista
          está a la vista: se puede recorrer sin tocar nada, o filtrar
          escribiendo. Nada se esconde detrás de un desplegable.

          El recuadro con scroll y no la lista entera: 243 filas sueltas
          empujan el botón "Continuar" fuera de cualquier pantalla, y el
          paciente que no sabe que hay un botón ahí abajo no llega nunca. */}
      {hayCatalogo && !elegida && (
        <div className="-mt-2 max-h-72 overflow-y-auto rounded-xl border border-input bg-background p-1.5">
          {filtradas.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-muted-foreground">
              No encontramos ninguna obra social con «{busquedaOS.trim()}». Probá con otra parte
              del nombre, sin siglas ni puntos.
            </p>
          ) : (
            filtradas.map((os) => (
              <button
                key={os.id}
                type="button"
                onClick={() => {
                  setElegida(os)
                  setBusquedaOS("")
                  setErrores((previos) => ({ ...previos, obraSocial: "" }))
                }}
                className={CLASES_OPCION}
              >
                {os.nombre}
                {/* Las que no permiten turnos online van en la misma lista,
                    marcadas. Ocultarlas dejaría al paciente de PAMI sin
                    encontrar la suya, y terminaría eligiendo una parecida que
                    no es la de él: llega a la clínica con la cobertura
                    equivocada, que es peor que derivarlo al teléfono. */}
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

      {/* Cuántas quedaron, sólo mientras el filtro está puesto.
          El que escribe tres letras y ve cuatro filas no sabe si la lista se
          filtró o si la clínica tiene cuatro convenios. */}
      {hayCatalogo && !elegida && busquedaOS.trim() && filtradas.length > 0 && (
        <p className="-mt-2 text-[13px] text-muted-foreground">
          {filtradas.length} de {catalogo!.length} obras sociales. Tocá la tuya para elegirla.
        </p>
      )}

      {/* Se dice qué falta hacer mientras la lista está abierta. Sin esto, la
          lista parece un autocompletado decorativo. */}
      {!hayCatalogo && !elegida && busquedaOS.trim().length >= MINIMO_PARA_BUSCAR && opcionesOS.length > 0 && (
        <p className="-mt-2 text-[13px] text-muted-foreground">Tocá la tuya para elegirla:</p>
      )}

      {/* Y cuando no hay ninguna, también se dice (17/11/2026).
          Antes, una búsqueda sin resultados no mostraba nada: el paciente
          escribía, no pasaba nada, y no sabía si el campo estaba roto, si
          tenía que seguir escribiendo o si su obra social no figuraba. Tres
          situaciones distintas con la misma pantalla en blanco. */}
      {!hayCatalogo && !elegida && busquedaOS.trim().length >= MINIMO_PARA_BUSCAR && opcionesOS.length === 0 && (
        <p className="-mt-2 text-[13px] text-muted-foreground">
          No encontramos ninguna obra social con «{busquedaOS.trim()}». Probá con otra parte del
          nombre, sin siglas ni puntos.
        </p>
      )}

      {!hayCatalogo && !elegida && opcionesOS.length > 0 && (
        <div className="-mt-2 space-y-2">
          {opcionesOS.map((os) => (
            <button
              key={os.id}
              type="button"
              onClick={() => {
                setElegida(os)
                setOpcionesOS([])
              }}
              className={`${CLASES_OPCION} border bg-card`}
            >
              {os.nombre}
              {/* Las que no permiten turnos online se muestran igual, marcadas.
                  Ocultarlas dejaría al paciente buscando la suya sin encontrarla,
                  y terminaría eligiendo una parecida que no es la de él. */}
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

      {errores.general && <Aviso titulo="No pudimos guardar tus datos" detalle={errores.general} tono="error" />}

      <BotonPrimario type="submit" deshabilitado={cargando}>
        {cargando ? <Enviando>Guardando…</Enviando> : "Continuar"}
      </BotonPrimario>
    </form>
  )
}
