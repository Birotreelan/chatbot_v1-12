# Pausa de envíos de WhatsApp

Permite cortar por completo el gasto de WhatsApp de una cuenta, desde un sistema
externo y sin intervención nuestra.

Mientras la pausa está activa **no sale ningún mensaje hacia WhatsApp**: ni
respuestas del asistente, ni recordatorios de turno, ni confirmaciones del
portal web, ni lo que escriba un operador desde el panel de soporte.

Los mensajes de los pacientes **se siguen recibiendo**: quedan guardados y
visibles en el monitor de conversaciones. WhatsApp cobra los mensajes enviados,
no los recibidos, así que recibir no tiene costo.

La pausa **no vence sola**. Dura hasta que se la reanude.

---

## Autenticación

Todas las llamadas llevan la clave en el encabezado `x-api-key`.

```
x-api-key: <clave>
```

**La clave nunca va en la URL.** Las direcciones quedan escritas en logs de
servidores, proxies e intermediarios, y una credencial en un log es una
credencial filtrada.

Hay dos tipos de clave, y la diferencia es si hace falta indicar de qué cliente
se trata.

### Clave compartida (la habitual)

Una sola clave para todas las cuentas. Como no identifica a ninguna en
particular, **todos los llamados tienen que indicar `cliente_id`**: es el mismo
UUID que figura como "Cliente ID" en la configuración de la cuenta.

```json
{ "cliente_id": "faf82cd7-4b56-11ef-b8bf-7824af3b5123", "pausado": true }
```

Si falta, la respuesta es `400`.

### Clave por cliente

Opcional. Identifica la cuenta por sí sola, así que **no hace falta mandar
`cliente_id`**: con ella sólo se puede pausar la cuenta a la que pertenece. Se
muestra una sola vez al emitirla y emitir una nueva anula la anterior.

Si una cuenta tiene clave propia, sigue funcionando igual que antes.

Una clave inválida o ausente devuelve `401`.

---

## Pausar

```http
POST https://treelan-bot.vercel.app/api/envios/pausa
x-api-key: <clave>
Content-Type: application/json

{
  "cliente_id": "faf82cd7-4b56-11ef-b8bf-7824af3b5123",
  "pausado": true,
  "motivo": "corte por presupuesto del mes"
}
```

`cliente_id` es obligatorio con la clave compartida y se omite con la clave por
cliente. `motivo` es opcional (máximo 200 caracteres) y sirve para saber después
por qué se pausó.

Respuesta `200`:

```json
{
  "exito": true,
  "cliente": "Salud Ocular",
  "pausado": true,
  "mensaje": "Envíos pausados. No se va a enviar ningún mensaje hasta que se reanude."
}
```

## Reanudar

El mismo llamado con `"pausado": false`.

```json
{
  "exito": true,
  "cliente": "Salud Ocular",
  "pausado": false,
  "mensaje": "Envíos reanudados."
}
```

## Consultar el estado

```http
GET https://treelan-bot.vercel.app/api/envios/pausa?cliente_id=faf82cd7-4b56-11ef-b8bf-7824af3b5123
x-api-key: <clave>
```

Con la clave por cliente, el parámetro `cliente_id` se omite.

Pausada:

```json
{
  "exito": true,
  "cliente": "Salud Ocular",
  "pausado": true,
  "desde": "2026-10-01T14:30:00.000Z",
  "por": "api",
  "motivo": "corte por presupuesto del mes"
}
```

Activa:

```json
{ "exito": true, "cliente": "Salud Ocular", "pausado": false }
```

`por` indica desde dónde se cambió: `api` si fue por este endpoint, o el nombre
del usuario si lo hicimos desde nuestro panel.

---

## Códigos de respuesta

| Código | Qué pasó | Qué hacer |
|---|---|---|
| `200` | Listo | — |
| `400` | Falta el campo `pausado`, o falta `cliente_id` usando la clave compartida | Corregir el cuerpo del pedido |
| `401` | Clave inválida o ausente | Revisar el encabezado `x-api-key` |
| `503` | No se pudo guardar el estado | Reintentar en unos segundos |

---

## Detalles que importan al integrar

**El valor es explícito, nunca alternante.** Se manda `true` o `false`, no una
orden de "cambiar al estado contrario". Esto hace que **repetir el pedido sea
seguro**: si un timeout dispara un reintento automático, el segundo llamado deja
el mismo resultado que el primero. Un endpoint que alternara reanudaría los
envíos que se acababan de cortar.

**La pausa tarda unos segundos en aplicarse.** Hasta tres, por una caché
interna. Un mensaje que ya estaba saliendo en ese momento puede alcanzar a
irse.

**Un recordatorio que caía durante la pausa no se envía ni se guarda para
después.** No hay cola: si se reanuda al día siguiente, los recordatorios de
ayer no salen. Es deliberado — mandarlos al reanudar produciría una avalancha de
avisos sobre turnos que ya pasaron.

**El paciente no recibe ningún aviso.** Quien escriba durante la pausa no va a
obtener respuesta de ninguna clase. Conviene tenerlo presente antes de pausar
por períodos largos.

---

## Ejemplos

### cURL

```bash
# Pausar
curl -X POST https://treelan-bot.vercel.app/api/envios/pausa \
  -H "x-api-key: $TREELAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cliente_id": "faf82cd7-4b56-11ef-b8bf-7824af3b5123", "pausado": true, "motivo": "cierre por vacaciones"}'

# Reanudar
curl -X POST https://treelan-bot.vercel.app/api/envios/pausa \
  -H "x-api-key: $TREELAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cliente_id": "faf82cd7-4b56-11ef-b8bf-7824af3b5123", "pausado": false}'

# Consultar
curl "https://treelan-bot.vercel.app/api/envios/pausa?cliente_id=faf82cd7-4b56-11ef-b8bf-7824af3b5123" \
  -H "x-api-key: $TREELAN_API_KEY"
```

### PHP

```php
<?php
function treelanPausarEnvios(bool $pausado, ?string $motivo = null): array
{
    $cuerpo = ['cliente_id' => getenv('TREELAN_CLIENTE_ID'), 'pausado' => $pausado];
    if ($motivo !== null) {
        $cuerpo['motivo'] = $motivo;
    }

    $ch = curl_init('https://treelan-bot.vercel.app/api/envios/pausa');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . getenv('TREELAN_API_KEY'),
        ],
        CURLOPT_POSTFIELDS     => json_encode($cuerpo),
    ]);

    $respuesta = curl_exec($ch);
    $codigo    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($codigo !== 200) {
        // Reintentar es seguro: el valor es explícito, no alternante.
        throw new RuntimeException("Treelan respondió $codigo: $respuesta");
    }

    return json_decode($respuesta, true);
}
```

### Node

```js
async function pausarEnvios(pausado, motivo) {
  const r = await fetch("https://treelan-bot.vercel.app/api/envios/pausa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.TREELAN_API_KEY,
    },
    body: JSON.stringify({
      cliente_id: process.env.TREELAN_CLIENTE_ID,
      pausado,
      ...(motivo ? { motivo } : {}),
    }),
  })

  if (!r.ok) throw new Error(`Treelan respondió ${r.status}: ${await r.text()}`)
  return r.json()
}
```
