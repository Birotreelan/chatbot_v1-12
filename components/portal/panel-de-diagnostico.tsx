/**
 * Lo que esta pantalla consultó y lo que le contestaron (28/10/2026).
 *
 * ── Quién lo ve ────────────────────────────────────────────────────────────
 *
 * Nadie, salvo que la URL traiga `?debug=1` Y se cumpla una de dos: que el
 * enlace sea de prueba, o que el navegador tenga una sesión de super_admin del
 * panel. La decisión la toma la página; acá sólo se dibuja.
 *
 * El portal es público para quien tenga el enlace, y esto muestra la ficha del
 * paciente y la respuesta cruda del sistema de la clínica. Un `?debug=1` sin
 * compuerta sería publicar eso en una URL que viaja por WhatsApp.
 *
 * ── Por qué al pie y colapsado ─────────────────────────────────────────────
 *
 * Porque se mira después de ver la pantalla: primero el síntoma —"dice que no
 * hay turnos"— y recién después el porqué. Arriba empujaría el contenido real
 * y cambiaría lo que se está diagnosticando.
 *
 * `<details>` nativo y no un acordeón con estado: funciona sin JavaScript, que
 * es justo lo que uno quiere de una herramienta para cuando algo anda mal.
 */

import type { AnotacionDeDiagnostico } from "@/lib/portal/diagnostico"

export function PanelDeDiagnostico({
  anotaciones,
  encabezado,
}: {
  anotaciones: AnotacionDeDiagnostico[]
  /** Lo que la página sabe y no sale de una consulta: el paso, los filtros, la identidad. */
  encabezado?: Record<string, unknown>
}) {
  if (anotaciones.length === 0 && !encabezado) return null

  return (
    <details className="mt-8 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/20 p-3 text-left">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Diagnóstico · {anotaciones.length} {anotaciones.length === 1 ? "consulta" : "consultas"}
      </summary>

      {encabezado && (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[11px] leading-snug text-foreground">
          {JSON.stringify(encabezado, null, 2)}
        </pre>
      )}

      {anotaciones.map((a, i) => (
        <div key={i} className="mt-3 border-t border-muted-foreground/20 pt-3">
          <p className="text-xs font-semibold text-foreground">
            {i + 1}. {a.titulo}
            {typeof a.ms === "number" && (
              <span className="ml-2 font-normal text-muted-foreground">{a.ms} ms</span>
            )}
          </p>
          {a.resumen && <p className="mt-0.5 text-xs text-muted-foreground">{a.resumen}</p>}

          {a.parametros && (
            <>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Se envió
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[11px] leading-snug">
                {JSON.stringify(a.parametros, null, 2)}
              </pre>
            </>
          )}

          {a.crudo !== undefined && (
            <>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Contestó
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[11px] leading-snug">
                {JSON.stringify(a.crudo, null, 2)}
              </pre>
            </>
          )}
        </div>
      ))}
    </details>
  )
}
