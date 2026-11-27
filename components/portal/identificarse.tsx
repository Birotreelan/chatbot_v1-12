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
import { useState } from "react"
import { Aviso, BotonPrimario } from "./marco"
/**
 * Las piezas compartidas salieron de este archivo el 27/11/2026, cuando
 * apareció el segundo usuario: la pantalla donde el paciente con ficha corrige
 * su cobertura. El campo de obra social tiene cinco comportamientos adentro,
 * cada uno con un caso real detrás, y copiarlos habría dejado dos versiones
 * que se separan en el primer ajuste. Ver ./campos.tsx y ./obra-social.tsx.
 */
import { CLASES_CAMPO, Campo, Enviando } from "./campos"
import { CampoDeObraSocial, type ObraSocial } from "./obra-social"

/**
 * A dónde volver después de guardar la identidad (27/11/2026).
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * Reportado por Nicolás y reproducido en el enlace real: el paciente completa
 * todo el proceso, llega al repaso final, toca "Corregir mis datos", vuelve a
 * la pantalla del DNI —prellenada, bien— aprieta Continuar y aparece en
 * "¿A qué sede querés ir?". Perdió la sede, el tipo de búsqueda, la fecha y el
 * horario que ya había elegido. Desde su lado, el proceso empieza de nuevo.
 *
 * ── Por qué pasaba ───────────────────────────────────────────────────────
 *
 * Volvía a `/p/<token>` a secas. El `replace` limpia la query a propósito
 * —para sacarse de encima el `?paso=` con el que se llegó a corregir, que si
 * no lo deja atrapado en esa pantalla— y de paso se llevaba `sedeId`,
 * `tipoBusqueda`, `profesionalId` y todo lo demás, que viven ahí.
 *
 * Así que se saca SÓLO `paso`. El resto de los filtros se conserva, que es lo
 * que hace que "corregir" sea corregir un dato y no empezar de cero.
 *
 * El horario elegido no está en la URL —vive en el estado del selector— así
 * que ése se vuelve a elegir igual. Y está bien que así sea: si el paciente
 * cambió el DNI, cambió la ficha y puede haber cambiado la obra social, con lo
 * cual la agenda que vio ya no es necesariamente la suya.
 */
function volverAlFlujo(ruta: string, token: string): string {
  const base = `/${ruta}/${token}`
  if (typeof window === "undefined") return base

  const parametros = new URLSearchParams(window.location.search)
  parametros.delete("paso")
  const query = parametros.toString()
  return query ? `${base}?${query}` : base
}

/** Paso 1: el DNI, solo. */
export function PedirDNI({
  token,
  paraFamiliar,
  valorInicial,
  ruta = "p",
}: {
  /**
   * El prop `debug` se fue con el arreglo del 27/11/2026.
   *
   * Existía porque el `replace` limpiaba la query y se llevaba puesto el
   * `?debug=1` (30/10/2026): justo después de identificarse —que es donde se
   * resuelve la obra social, o sea lo que uno vino a mirar— el panel de
   * diagnóstico desaparecía. Ahora `volverAlFlujo` conserva la query entera,
   * así que el panel vuelve solo, igual que la sede y el resto de los filtros.
   */
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
        router.replace(volverAlFlujo(ruta, token))
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

/** Paso 2: sólo para quien no tiene ficha. */
export function DarseDeAlta({
  token,
  dni,
  paraFamiliar,
  valoresIniciales,
  ruta = "p",
}: {
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
  /**
   * De la obra social acá queda sólo qué eligió el paciente.
   *
   * El catálogo, el reintento, el filtro local, la búsqueda contra el proxy y
   * el marcado de las que no permiten turnos online se fueron a
   * ./obra-social.tsx el 27/11/2026, cuando la misma pantalla hizo falta para
   * corregir la cobertura de un paciente que ya tiene ficha.
   */
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
    //
    // El mensaje dejó de distinguir "escribiste pero no elegiste" de "no
    // escribiste nada" (27/11/2026): esa diferencia la sabía este componente
    // cuando tenía el texto tipeado, y ahora lo tiene el campo. Pedirle al
    // campo que lo informe hacia arriba sería arrastrar su estado interno para
    // elegir entre dos frases que dicen lo mismo —tocá la de la lista—.
    if (!elegida) {
      setErrores({ obraSocial: "Tocá tu obra social en la lista para elegirla." })
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
        router.replace(volverAlFlujo(ruta, token))
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

      {/* Todo el campo —el estado "elegida vs. escrita", el catálogo, el
          filtro y el aviso de las que no dan turnos online— vive en
          ./obra-social.tsx desde el 27/11/2026. */}
      <CampoDeObraSocial
        token={token}
        etiqueta={paraFamiliar ? "Obra social del paciente" : "Obra social"}
        error={errores.obraSocial}
        inicial={
          valoresIniciales?.obraSocialId && valoresIniciales?.obraSocialNombre
            ? { id: valoresIniciales.obraSocialId, nombre: valoresIniciales.obraSocialNombre }
            : null
        }
        onCambio={(os) => {
          setElegida(os)
          if (os) setErrores((previos) => ({ ...previos, obraSocial: "" }))
        }}
      />

      {errores.general && <Aviso titulo="No pudimos guardar tus datos" detalle={errores.general} tono="error" />}

      <BotonPrimario type="submit" deshabilitado={cargando}>
        {cargando ? <Enviando>Guardando…</Enviando> : "Continuar"}
      </BotonPrimario>
    </form>
  )
}

/**
 * El paciente que YA tiene ficha corrige su cobertura (27/11/2026).
 *
 * ── Qué puede cambiar, y por qué sólo eso ─────────────────────────────────
 *
 * La obra social y el número de afiliado. No el nombre, el apellido ni el
 * email: ésos salen de la ficha de la clínica y el proxy no tiene ninguna
 * acción para escribirlos —sus escrituras son `set_turno`, `confirmar_turno` y
 * `cancelar_turno`, nada más—.
 *
 * Los dos que sí se pueden cambiar es porque `set_turno` los lleva:
 * `Deudor_Id` y `Nro_Afiliado`. Así que el cambio llega a ESE turno y un
 * comentario le avisa a la clínica para que corrija la ficha. Ver
 * lib/turnos/comentario-de-la-cobertura.ts.
 *
 * ── Lo que esta pantalla NO promete ───────────────────────────────────────
 *
 * Que la ficha quede corregida. El texto lo dice: la próxima vez que entre va
 * a volver a ver la cobertura vieja hasta que alguien de la clínica la
 * actualice. Prometerlo y que no pase es peor que no ofrecerlo.
 */
export function CorregirCobertura({
  token,
  ruta = "p",
  valoresIniciales,
}: {
  ruta?: string
  token: string
  valoresIniciales?: {
    obraSocialId?: string
    obraSocialNombre?: string
    nroAfiliado?: string
  }
}) {
  const [elegida, setElegida] = useState<ObraSocial | null>(null)
  const [nroAfiliado, setNroAfiliado] = useState(valoresIniciales?.nroAfiliado || "")
  const router = useRouter()
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()

    if (!elegida) {
      setErrores({ obraSocial: "Tocá tu obra social en la lista para elegirla." })
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
          accion: "cobertura",
          obraSocialId: elegida.id,
          obraSocialNombre: elegida.nombre,
          nroAfiliado: nroAfiliado.trim() || undefined,
        }),
      })
      const data = await r.json()
      if (data.ok) {
        /**
         * Se vuelve al flujo SIN los filtros de la agenda (27/11/2026).
         *
         * Pedido de Nicolás: "lo ideal es que el turno se busque de nuevo luego
         * de cambiar la obra social". Y es lo correcto, no sólo lo pedido: la
         * agenda se filtra por `Deudor_Id`, así que el horario que el paciente
         * había elegido pertenece a la cobertura anterior y puede no existir
         * para la nueva.
         *
         * La sede SÍ se conserva: no depende de la obra social, y hacérsela
         * elegir de nuevo sería la misma pérdida de pasos que arreglamos hoy en
         * `volverAlFlujo`.
         */
        const parametros = new URLSearchParams(
          typeof window === "undefined" ? "" : window.location.search,
        )
        for (const filtro of ["paso", "tipoBusqueda", "profesionalId", "especialidadId", "fecha"]) {
          parametros.delete(filtro)
        }
        const query = parametros.toString()
        router.replace(`/${ruta}/${token}${query ? `?${query}` : ""}`)
        router.refresh()
        return
      }
      setErrores(data.errores || { general: data.error || "Revisá los datos." })
      setCargando(false)
    } catch {
      setErrores({ general: "No pudimos conectarnos. Revisá tu señal y probá de nuevo." })
      setCargando(false)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <CampoDeObraSocial
        token={token}
        etiqueta="Obra social"
        error={errores.obraSocial}
        inicial={
          valoresIniciales?.obraSocialId && valoresIniciales?.obraSocialNombre
            ? { id: valoresIniciales.obraSocialId, nombre: valoresIniciales.obraSocialNombre }
            : null
        }
        onCambio={(os) => {
          setElegida(os)
          if (os) setErrores((previos) => ({ ...previos, obraSocial: "" }))
        }}
      />

      <Campo etiqueta="Número de afiliado" error={errores.nroAfiliado}>
        <input
          autoComplete="off"
          value={nroAfiliado}
          onChange={(e) => setNroAfiliado(e.target.value)}
          placeholder="El que figura en tu credencial"
          className={CLASES_CAMPO}
        />
      </Campo>

      {/* ── El aviso, reescrito (27/11/2026) ──────────────────────────────
          Decía:

            "Esto se aplica a este turno. Le avisamos a la clínica para que
             actualice tu ficha. Hasta que lo haga, la próxima vez vas a ver la
             cobertura anterior."

          Nicolás lo marcó como confuso y tenía razón. Tres problemas:

           - "tu ficha" y "la cobertura anterior" son conceptos NUESTROS. El
             paciente no sabe que existe una ficha ni por qué su cobertura
             tendría versiones.
           - de los tres datos, dos eran plomería interna y ninguno le servía
             para decidir nada.
           - y el conjunto se lee como una advertencia de que el cambio no
             funcionó, que es lo contrario de lo que pasa.

          Queda lo que sí le sirve: para qué vale lo que acaba de cambiar, que
          alguien lo va a ver, y qué conviene que haga el día del turno. El
          tono pasa de `atencion` a `neutro`: no es un problema de nadie, y el
          amarillo con el triángulo decía "algo salió mal". */}
      <Aviso
        titulo="El cambio es válido solo para este turno."
        detalle="La clínica verá el cambio de obra social junto con tu turno. Recordá llevar la nueva credencial el día de la consulta."
      />

      {errores.general && <Aviso titulo="No pudimos guardar los datos" detalle={errores.general} tono="error" />}

      <BotonPrimario type="submit" deshabilitado={cargando}>
        {cargando ? <Enviando>Guardando…</Enviando> : "Guardar y buscar turnos"}
      </BotonPrimario>
    </form>
  )
}
