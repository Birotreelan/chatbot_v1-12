"use client"

/**
 * Avisa al servidor que el paciente llegó a cierto punto del recorrido.
 *
 * ── Por qué es un componente cliente y no un `<script>` en línea ───────────
 *
 * La primera versión era un `<script dangerouslySetInnerHTML>`, como el aviso
 * de "abrió el enlace" que vivía en `marco.tsx`. Ahí funcionaba porque el
 * marco se renderiza en el servidor y el navegador ejecuta ese script al
 * recibir el HTML.
 *
 * No sirve para los avisos que salen de una pantalla cliente —la agenda vacía
 * del selector, por ejemplo—: React no ejecuta los scripts que inserta por
 * `dangerouslySetInnerHTML` al renderizar del lado del cliente, así que el
 * aviso de "no había horarios" nunca habría salido, y lo peor es que no
 * habría fallado: el monitor se vería igual que si nadie hubiera llegado a esa
 * pantalla. Un dato ausente que parece un dato.
 *
 * Con `useEffect` corre en los dos casos. El costo es que estas pantallas ya
 * mandan React al navegador de todos modos.
 *
 * ── El resto ───────────────────────────────────────────────────────────────
 *
 * `keepalive` para que el pedido sobreviva si el paciente toca algo enseguida
 * —el caso normal es que lea el aviso y vuelva—, y el error se traga: esto es
 * observación, no puede romperle la pantalla a nadie.
 *
 * La ruta anota una sola vez por enlace y por hito, así que renderizarlo en
 * cada paso o en cada recarga no ensucia el monitor; el `ref` evita el pedido
 * repetido del modo estricto en desarrollo, que no rompe nada pero confunde al
 * mirar la red. Ver `app/api/portal/hito/route.ts`.
 */

import { useEffect, useRef } from "react"

import type { HitoDelPortal } from "@/lib/portal/monitor"

export function AnotarHito({ token, hito }: { token?: string; hito: HitoDelPortal }) {
  const yaSeAvisó = useRef(false)

  useEffect(() => {
    if (!token || yaSeAvisó.current) return
    yaSeAvisó.current = true

    fetch("/api/portal/hito", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, hito }),
    }).catch(() => {})
  }, [token, hito])

  return null
}
