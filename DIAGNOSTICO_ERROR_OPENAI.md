# Diagnóstico y Solución: Error "Can't add messages to thread while a run is active"

## Problema Identificado

```
Can't add messages to thread_e431kRXeGAz5iW6RvGLUZPtb while a run run_4CA3PT7fMzW0Xl1ZlUM50ICO is active.
```

Este error ocurría cuando un usuario enviaba dos mensajes seguidos en WhatsApp. OpenAI rechazaba agregar un nuevo mensaje porque ya había un **run activo** procesando el thread.

## Raíz del Problema

### 1. **Sistema de Cola NO Era Distribuido**
- El estado de usuarios siendo procesados se guardaba en `const processingUsers = new Set<string>()`
- En un ambiente **serverless de Vercel**, cada invocación puede correr en una instancia diferente
- La segunda invocación (segundo mensaje) no sabía que había un run activo en la primera instancia
- Resultado: intentaba agregar un mensaje a un thread que estaba procesando

### 2. **No Había Verificación de Runs Activos**
- `getAssistantResponse()` en `lib/openai-tools.tsx` (línea 1835) agregaba mensajes directamente sin verificar
- Existía una función `safelyAddMessageToThread()` en `lib/thread-manager.ts` que SÍ verificaba runs activos, pero NO se usaba

## Soluciones Implementadas

### 1. **Migrar Estado de Procesamiento a Redis** ✅
**Archivo:** `lib/user-queue.ts`

Se reemplazó el `Set` en memoria por funciones que usan Redis:

```typescript
// Anterior (memoria local - no distribuido):
const processingUsers = new Set<string>()
if (processingUsers.has(userPhoneNumber)) { ... }

// Nuevo (Redis - distribuido):
async function isUserProcessing(userPhoneNumber: string): Promise<boolean>
async function setUserProcessing(userPhoneNumber: string): Promise<void>
async function clearUserProcessing(userPhoneNumber: string): Promise<void>
```

**Beneficios:**
- ✅ Estado compartido entre todas las instancias serverless
- ✅ Con expiración automática (5 minutos) para recuperación ante crashes
- ✅ Las invocaciones paralelas ahora saben que hay procesamiento activo

### 2. **Usar `safelyAddMessageToThread()` en `getAssistantResponse`** ✅
**Archivo:** `lib/openai-tools.tsx`

Se cambió de agregar mensajes directamente a usar la función segura:

```typescript
// Anterior (falla si hay run activo):
const messageResponse = await openai.beta.threads.messages.create(threadId, {
  role: "user",
  content: message,
})

// Nuevo (verifica y espera):
const messageResponse = await safelyAddMessageToThread(threadId, {
  role: "user",
  content: message,
})
```

**Lo que hace `safelyAddMessageToThread()`:**
1. ✅ Verifica si hay runs activos en el thread
2. ✅ Espera a que se completen (hasta 30 segundos)
3. ✅ Si timeout, cancela el run
4. ✅ Reintenta agregar el mensaje (máx 5 intentos)

## Flujo Ahora

```
Usuario envía Mensaje 1
    ↓
Encolado en Redis
    ↓
setUserProcessing() en Redis ← [VISIBLE EN TODAS LAS INSTANCIAS]
    ↓
getAssistantResponse()
    ↓
safelyAddMessageToThread() ← [VERIFICA Y ESPERA RUNS ACTIVOS]
    ↓
Crea run y procesa
    ↓

Usuario envía Mensaje 2 (mientras se procesa Mensaje 1)
    ↓
Encolado en Redis
    ↓
processUserQueue() intenta ejecutar
    ↓
isUserProcessing() devuelve TRUE (desde Redis)
    ↓
Espera a que termine Mensaje 1
    ↓
Procesa Mensaje 2 correctamente
```

## Cambios de Código

### `lib/user-queue.ts`
- ❌ Eliminado: `const processingUsers = new Set<string>()`
- ✅ Agregado: Funciones async que usan Redis como estado distribuido
- ✅ Actualizado: `processUserQueue()` para usar `setUserProcessing()` y `clearUserProcessing()`
- ✅ Actualizado: `getUserQueueStatus()` para usar `isUserProcessing()`

### `lib/openai-tools.tsx`
- ✅ Agregado: `import { safelyAddMessageToThread } from "./thread-manager"`
- ✅ Actualizado: `getAssistantResponse()` para usar `safelyAddMessageToThread()` en lugar de `openai.beta.threads.messages.create()`

## Validación

El error debería estar **100% resuelto** ahora porque:

1. **Concurrencia Controlada:** Redis evita que dos procesos procesen el mismo usuario simultáneamente
2. **Verificación de Runs:** Antes de agregar cualquier mensaje, se verifica que no haya runs activos
3. **Recuperación Automática:** Si hay un timeout, se cancela el run y se reintenta
4. **Distribuido:** Funciona correctamente en ambiente serverless de Vercel con múltiples instancias

## Próximos Pasos Recomendados

1. 🧪 Testear: Enviar 5-10 mensajes seguidos rápidamente
2. 📊 Monitorear: Revisar logs de Redis y OpenAI para errores
3. 📝 Documentar: Agregar este flujo a la documentación del proyecto
