# Optimizacion de Bandwidth en Upstash Redis

## Problema Detectado

El proyecto excedia el limite de 50GB de bandwidth mensual (55GB/50GB = 110%), generando cargos adicionales en Upstash.

**Nota:** El bandwidth en Upstash se refiere a datos transferidos en operaciones de lectura/escritura, no al almacenamiento en disco.

---

## Soluciones Implementadas

### 1. Reduccion de TTL de Conversaciones (15 dias -> 7 dias)

**Archivo:** `lib/conversations.ts`

```typescript
// ANTES
const CONVERSATION_TTL = 15 * 24 * 60 * 60 // 15 dias

// DESPUES  
const CONVERSATION_TTL = 7 * 24 * 60 * 60 // 7 dias
```

**Impacto:** Reduce ~50% del almacenamiento de conversaciones, menos datos que transferir.

---

### 2. Paginacion en Lecturas de Mensajes

**Archivo:** `lib/conversations.ts`

La funcion `getConversationMessages()` ahora soporta paginacion:

```typescript
// Nueva firma
export async function getConversationMessages(
  configId: string, 
  phoneNumber: string,
  limit: number = 50,    // Por defecto 50 mensajes
  offset: number = 0
): Promise<{ messages: ConversationMessage[]; total: number; hasMore: boolean }>
```

**Cambios en APIs que la usan:**

| Archivo | Cambio |
|---------|--------|
| `app/api/conversations/messages/route.ts` | Acepta `limit` y `offset` como query params |
| `app/api/support/session/[id]/route.ts` | Usa limite de 100 mensajes para soporte |
| `app/api/support/actions/route.ts` | Usa limite de 100 mensajes para soporte |
| `app/api/conversations/export/route.ts` | Usa `getAllConversationMessages()` para exportar todo |

**Impacto:** Reduce drasticamente el bandwidth al no cargar conversaciones completas (que pueden tener cientos de mensajes).

---

### 3. Limpieza de Conversaciones en Cron Job

**Archivo:** `app/api/cron/cleanup/route.ts`

Se agregaron 3 nuevas tareas de limpieza:

1. **Conversaciones antiguas:** Elimina conversaciones con ultimo mensaje > 7 dias
2. **Contactos huerfanos:** Elimina registros de contactos cuyas conversaciones ya expiraron
3. **Flags de pausa huerfanos:** Elimina flags de `conversation_paused:*` sin conversacion asociada

**Nuevas variables de entorno:**

```bash
CLEANUP_CONVERSATION_DAYS=7  # Dias para mantener conversaciones (default: 7)
```

**Metricas nuevas registradas:**

- `cleanup_conversations_deleted`
- `cleanup_conversation_messages_deleted`
- `cleanup_contacts_deleted`
- `cleanup_paused_flags_deleted`

---

## Estimacion de Ahorro

| Optimizacion | Ahorro Estimado |
|--------------|-----------------|
| TTL 15 -> 7 dias | ~50% del almacenamiento |
| Paginacion (50 vs all) | ~70-90% en lecturas de mensajes |
| Limpieza activa de conversaciones | ~20% adicional |

**Total estimado:** 60-80% de reduccion en bandwidth mensual.

---

## Verificacion

### Ejecutar limpieza manualmente

```bash
curl -X GET https://tu-dominio.vercel.app/api/cron/cleanup
```

### Respuesta esperada

```json
{
  "success": true,
  "threadsDeleted": 5,
  "metricsCleanedUp": 120,
  "cacheEntriesDeleted": 45,
  "rateLimitEntriesDeleted": 0,
  "conversationsDeleted": 230,
  "conversationMessagesDeleted": 4500,
  "contactsDeleted": 180,
  "pausedFlagsDeleted": 12,
  "keysScanned": {
    "threads": 50,
    "metrics": 30,
    "cache": 100,
    "rateLimit": 20,
    "conversations": 500,
    "contacts": 300,
    "pausedFlags": 25
  },
  "timestamp": "2024-01-15T02:00:00.000Z"
}
```

---

## Monitoreo Recomendado

1. **Revisar dashboard de Upstash** semanalmente para verificar reduccion de bandwidth
2. **Logs del cron job** para ver cuantos elementos se eliminan cada dia
3. **Metricas en Redis:**
   - `cleanup_conversations_deleted`
   - `cleanup_conversation_messages_deleted`

---

## Ajustes Futuros (si se necesita mas reduccion)

1. **Reducir TTL a 3-5 dias** si 7 dias sigue siendo excesivo
2. **Reducir limite de paginacion** de 50 a 30 mensajes
3. **Ejecutar cron 2 veces al dia** en lugar de 1
4. **Comprimir mensajes** antes de guardar en Redis (gzip)
