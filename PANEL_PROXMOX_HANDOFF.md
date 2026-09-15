# Panel de Atención Proxmox — Entrega al equipo de desarrollo

Documento de traspaso del panel `/support_proxmox`, creado el 15/9/2026.

---

## Qué es

Una copia independiente del panel de atención humana, para adaptarla a clientes
sobre infraestructura Proxmox **sin tocar el panel que está en producción**.

Los dos paneles conviven. Cada cliente usa uno u otro según un checkbox en su
configuración.

Para saber a simple vista cuál se cargó, el encabezado del panel Proxmox dice
**"Panel de Atención Treelan Iris Proxmox"**.

---

## Repositorio

```
https://github.com/Birotreelan/chatbot_v1-12
```

Rama `main`, commits `8a8dfcb` y `1953549`.

---

## Archivos del panel (editables libremente)

Estos 16 archivos son la copia. **Editarlos no afecta al panel original.**

```
app/support_proxmox/
├── layout.tsx                 # Autenticación + verificación de que el cliente es Proxmox
├── page.tsx                   # Listado de conversaciones
└── [sessionId]/page.tsx       # Vista de una conversación

components/support-proxmox/
├── support-dashboard.tsx      # Contenedor principal (acá está el título)
├── support-nav.tsx            # Barra superior
├── sessions-list.tsx          # Lista de sesiones
├── session-card.tsx           # Tarjeta de cada conversación ("Tomar" / "Ver")
├── conversation-view.tsx      # Vista de conversación
├── conversation-monitor.tsx   # Monitor en vivo
├── message-list.tsx           # Mensajes
├── message-input.tsx          # Campo de respuesta del agente
├── patient-info-panel.tsx     # Ficha del paciente (panel derecho)
├── close-session-dialog.tsx   # Diálogo de cierre
├── session-provider.tsx       # Contexto de sesión (propagación del _sid)
├── sso-handler.tsx            # Entrada por SSO
└── support-settings.tsx       # Configuración del panel
```

---

## Lo que NO conviene tocar sin avisar

Estos archivos son **compartidos con el panel original**. Un cambio acá afecta a
todos los clientes, no sólo a los Proxmox:

| Archivo | Rol |
|---|---|
| `app/api/support/*` (7 rutas) | Backend del panel. **Los dos paneles las usan.** |
| `lib/auth.ts` | Autenticación y `rutaPanelSoporte()` |
| `lib/types.ts` | Define `clienteProxmox` en `WhatsAppConfig` |
| `middleware.ts` | Autenticación, SSO e iframe |
| `components/dashboard/whatsapp-config-form.tsx` | El checkbox del dashboard |
| `components/ui/*` | Componentes visuales compartidos con toda la app |

Si el panel Proxmox necesita endpoints propios, conviene crear
`app/api/support_proxmox/*` en vez de modificar los existentes.

---

## Cómo se decide qué panel ve cada cliente

1. En el dashboard: **Configuración General → "Cliente Proxmox"** (debajo de
   *Datos de Derivación*).
2. Ese checkbox guarda `clienteProxmox: true` en la config del cliente.
3. `rutaPanelSoporte(tenantId)` en `lib/auth.ts` resuelve `/support_proxmox` o
   `/support`.
4. **Ambos layouts verifican y redirigen.** Un agente de un cliente Proxmox que
   entre a `/support` termina en `/support_proxmox`, y viceversa. Eso vale
   aunque llegue por un enlace viejo o escriba la URL a mano.

Ante cualquier error al leer la config, devuelve `/support`: es preferible
mandar al agente al panel conocido antes que dejarlo sin panel.

---

## Trabajar localmente (Cursor)

```bash
git clone https://github.com/Birotreelan/chatbot_v1-12.git
cd chatbot_v1-12
pnpm install
```

Hace falta un `.env.local` con las credenciales (OpenAI, Upstash Redis, WhatsApp).
**No están en el repo** y no deben subirse. Pedírselas a Nicolás, o traerlas del
proyecto de Vercel con:

```bash
npx vercel env pull .env.local
```

Después:

```bash
pnpm dev          # http://localhost:3000/support_proxmox
pnpm test         # tests (deben pasar antes de cualquier push)
```

---

## Desplegar

El proyecto está conectado a Vercel: **cada push dispara un deploy**.

> **Importante:** un push a `main` va a **producción**, donde hay clínicas
> atendiendo pacientes reales.

El flujo recomendado:

```bash
git checkout -b panel-proxmox
# ... trabajar ...
pnpm test
git push origin panel-proxmox
```

Vercel genera una **URL de preview** por cada rama, con su propio entorno. Ahí se
prueba sin riesgo. Cuando esté listo, se mergea a `main` mediante Pull Request.

Antes de cualquier push conviene correr:

```bash
./node_modules/.bin/next build && pnpm test
```

---

## Cosas a tener en cuenta

**El panel corre embebido en un iframe.** Por eso existe toda la maquinaria de
`_sid` en la URL y el header `X-Session-Id`: las cookies de terceros están
bloqueadas o restringidas en Safari y Chrome. Si tocan `session-provider.tsx` o
la navegación entre pantallas, hay que probar en **Chrome y Safari, en ventana
normal y privada** — los cuatro casos se comportan distinto. Ya hubo dos
incidentes por esto.

**Los dos paneles ya divergen.** Los arreglos que se hagan en `components/support/`
no llegan solos a `components/support-proxmox/`, ni al revés. Si encuentran un bug
que también existe en el panel original, conviene avisar para arreglarlo en los dos.

**El endpoint de datos del paciente está en revisión.** `/api/support/patient`
tenía un proxy mal resuelto; el equipo de backend lo está mirando. Si la ficha del
paciente aparece como "Datos no disponibles", puede ser eso y no un bug del panel.
