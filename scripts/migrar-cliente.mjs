#!/usr/bin/env node
/**
 * Migrar los datos de un `cliente_id` viejo a uno nuevo, desde la terminal.
 *
 *   SID=<session_id> node scripts/migrar-cliente.mjs <viejo> <nuevo>
 *   SID=<session_id> node scripts/migrar-cliente.mjs <viejo> <nuevo> --ejecutar
 *
 * Sin `--ejecutar` hace el ensayo: muestra exactamente qué movería y no
 * escribe nada.
 *
 * ── De dónde sale el SID ───────────────────────────────────────────────────
 *
 * Es la sesión del panel. En el navegador, logueado como super_admin, en la
 * consola:
 *
 *   document.cookie.match(/session_id=([^;]+)/)[1]
 *
 * La ruta lo acepta por query param `_sid`, que es el mismo camino que usa el
 * panel dentro de un iframe en Safari.
 *
 * ── Por qué llama a la API y no a Redis ────────────────────────────────────
 *
 * Porque la lógica de la migración —qué se suma, qué no se pisa, qué TTL se
 * respeta, que no se pueda correr dos veces— vive en
 * lib/migracion-cliente-id.ts. Un script que hablara con Redis por su cuenta
 * sería una segunda implementación de esas reglas, que empieza igual y se
 * desincroniza en el primer arreglo que se haga de un solo lado.
 *
 * Además evita tener las credenciales de Redis de producción en una terminal.
 */

const BASE = process.env.BASE_URL || "https://treelan-bot.vercel.app"
const SID = process.env.SID || ""

const [viejo, nuevo] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const ejecutar = process.argv.includes("--ejecutar")

if (!SID || !viejo || !nuevo) {
  console.error(`
Uso:  SID=<session_id> node scripts/migrar-cliente.mjs <viejo> <nuevo> [--ejecutar]

  SID        La sesión del panel (super_admin). En la consola del navegador:
             document.cookie.match(/session_id=([^;]+)/)[1]
  BASE_URL   Por omisión ${BASE}
  --ejecutar Escribe de verdad. Sin esto, sólo ensaya.
`)
  process.exit(1)
}

const url = (ruta) => `${BASE}${ruta}${ruta.includes("?") ? "&" : "?"}_sid=${encodeURIComponent(SID)}`

async function pedir(ruta, opciones = {}) {
  const r = await fetch(url(ruta), {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Session-Id": SID, ...(opciones.headers || {}) },
  })
  const texto = await r.text()
  let cuerpo
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    throw new Error(`Respuesta no-JSON (HTTP ${r.status}): ${texto.slice(0, 300)}`)
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${cuerpo.error || texto.slice(0, 300)}`)
  return cuerpo
}

/** Las estadísticas que se ven desde afuera, para comparar antes y después. */
async function estadisticas(id) {
  const r = await fetch(
    `${BASE}/api/appointment-stats?clienteId=${encodeURIComponent(id)}&startDate=2026-01-01&endDate=2030-12-31`,
  )
  if (!r.ok) return null
  const d = await r.json()
  return {
    confirmados: d.totalConfirmed,
    cancelados: d.totalCancelled,
    reagendados: d.totalRescheduled,
    dias: Object.keys(d.confirmedByDay || {}).length,
  }
}

function tabla(titulo, filas) {
  console.log(`\n${titulo}`)
  for (const [k, v] of Object.entries(filas)) {
    console.log(`  ${String(k).padEnd(26)} ${v}`)
  }
}

async function main() {
  console.log(`\nMigración de cliente_id\n  viejo: ${viejo}\n  nuevo: ${nuevo}\n  contra: ${BASE}`)

  const antes = await pedir(`/api/dashboard/migrar-cliente?viejo=${viejo}&nuevo=${nuevo}`)
  tabla("Claves en Redis", {
    "del id viejo": antes.viejo.claves,
    "del id nuevo": antes.nuevo.claves,
  })

  if (antes.viejo.claves === 0) {
    console.error("\nNo hay nada guardado bajo el id viejo. Revisá que sea el correcto.\n")
    process.exit(2)
  }

  const [statsViejo, statsNuevo] = await Promise.all([estadisticas(viejo), estadisticas(nuevo)])
  if (statsViejo && statsNuevo) {
    tabla("Estadísticas antes", {
      "viejo (confirmados)": `${statsViejo.confirmados}  ·  ${statsViejo.dias} días`,
      "nuevo (confirmados)": `${statsNuevo.confirmados}  ·  ${statsNuevo.dias} días`,
    })
  }

  // Siempre se ensaya primero, aunque se haya pedido ejecutar: es barato y es
  // la única forma de ver los conflictos antes de que dejen de ser evitables.
  const ensayo = await pedir("/api/dashboard/migrar-cliente", {
    method: "POST",
    body: JSON.stringify({ viejo, nuevo }),
  })

  tabla("Ensayo", {
    "claves encontradas": ensayo.clavesEncontradas,
    "se copian enteras": ensayo.claves.filter((c) => c.accion === "copiada").length,
    "se fusionan (suman)": ensayo.claves.filter((c) => c.accion === "fusionada").length,
    "conflictos (no se tocan)": ensayo.conflictos,
    errores: ensayo.errores,
    ...(ensayo.yaEjecutada ? { "YA SE EJECUTÓ EL": ensayo.yaEjecutada } : {}),
  })

  if (ensayo.conflictos > 0) {
    console.log("\n  Conflictos — el id nuevo ya tiene un valor y no se pisa:")
    for (const c of ensayo.claves.filter((x) => x.accion === "conflicto")) {
      console.log(`    ${c.origen}`)
    }
  }
  if (ensayo.errores > 0) {
    console.log("\n  Errores:")
    for (const c of ensayo.claves.filter((x) => x.accion === "error")) {
      console.log(`    ${c.origen} — ${c.detalle}`)
    }
  }

  if (!ejecutar) {
    console.log("\nEnsayo nada más. Para escribir de verdad, repetí con --ejecutar.\n")
    return
  }

  const real = await pedir("/api/dashboard/migrar-cliente", {
    method: "POST",
    body: JSON.stringify({ viejo, nuevo, ensayo: false }),
  })

  if (real.frenada) {
    console.error(
      `\nFrenada: esta migración ya se ejecutó el ${real.yaEjecutada}.` +
        `\nRepetirla duplicaría los contadores. Si de verdad hace falta, hay que llamar` +
        `\nla API con "forzar": true.\n`,
    )
    process.exit(3)
  }

  tabla("Ejecutada", {
    "claves movidas": real.clavesEncontradas,
    conflictos: real.conflictos,
    errores: real.errores,
  })

  const despues = await estadisticas(nuevo)
  if (despues) {
    tabla("Estadísticas del id nuevo, después", {
      confirmados: despues.confirmados,
      cancelados: despues.cancelados,
      reagendados: despues.reagendados,
      "días con datos": despues.dias,
    })
  }

  console.log(
    "\nLo viejo NO se borró: si algo quedó mal, el id viejo todavía tiene sus datos." +
      "\nPara borrarlo, una vez verificado:" +
      `\n  curl -X DELETE "${BASE}/api/dashboard/migrar-cliente?viejo=${viejo}&ensayo=false&_sid=$SID"\n`,
  )
}

main().catch((error) => {
  console.error(`\nError: ${error.message}\n`)
  process.exit(1)
})
