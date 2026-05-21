# Buffer de Agregación de Mensajes - Solución de Fluidez

## Problema Identificado

Cuando un usuario enviaba varios mensajes rápidamente en WhatsApp:
1. Cada mensaje se procesaba de forma completamente independiente
2. El sistema podía responder a "Hola" pidiendo DNI
3. Luego respondía a "Necesito turno" pidiendo DNI nuevamente
4. Cuando llegaba el DNI, los mensajes anteriores ya tenían respuestas contradictorias
5. **Resultado:** Pérdida total de fluidez conversacional

## Solución Implementada: Buffer de Agregación con Debounce

### Concepto
En lugar de procesar cada mensaje inmediatamente, el sistema ahora:

1. **Agrega mensajes** en un buffer por usuario durante 2.5 segundos
2. **Si llegan más mensajes**, reinicia el contador (debounce pattern)
3. **Cuando expira el timer**, procesa TODOS los mensajes juntos como un contexto único
4. **LLM recibe** un único prompt con todos los mensajes agregados

### Flujo Nuevo

```
Usuario envía: "Hola" → Se agrega a buffer, inicia timer de 2.5s
                 ↓
Usuario envía: "Necesito turno" → Se agrega a buffer, se reinicia el timer
                 ↓
Usuario envía: "Con dra Bustamante" → Se agrega a buffer, se reinicia el timer
                 ↓
[2.5s sin nuevos mensajes]
                 ↓
Sistema ejecuta processUserBuffer()
                 ↓
LLM recibe UN SOLO PROMPT:
"El usuario envió los siguientes mensajes:
1. Hola
2. Necesito turno  
3. Con dra Bustamante"
                 ↓
LLM responde UNA SOLA VEZ con contexto completo
                 ↓
Sistema guarda UNA respuesta coherente
```

## Archivos Modificados

### 1. **Nuevo: `lib/message-buffer.ts`**
Sistema de buffer en Redis con debounce:
- `addMessageToBuffer()` - Agrega mensaje al buffer y maneja el timer
- `getBufferedMessages()` - Obtiene los mensajes del buffer
- `flushMessageBuffer()` - Vacía el buffer y ejecuta `processUserBuffer()`
- `clearBuffer()` - Limpia manualmente el buffer

**Características:**
- Almacenamiento en Redis con expiración automática
- Timer de 2.5 segundos configurable
- Si Redis no está disponible, falla gracefully

### 2. **Modificado: `lib/whatsapp.tsx`**

#### a) Nueva función `processBufferedMessages()`
Reemplaza a `processIndividualMessage()` cuando hay múltiples mensajes:
- Concatena todos los mensajes: "1. msg1\n2. msg2\n3. msg3"
- Envía UN SOLO prompt al LLM con contexto agregado
- Guarda UN SOLO parámetro: `MensajesAgregados: N` en el bloque SISTEMA

#### b) Nueva función `processUserBuffer()`
Puente entre buffer y whatsapp:
- Obtiene mensajes del buffer
- Crea un `mockValue` de WhatsAppValue para compatibilidad
- Llama a `processBufferedMessages()` con todos los mensajes

#### c) Modificado: `handleMessage()`
**ANTES:** Llamaba a `enqueueUserMessage()` inmediatamente
**AHORA:** Llama a `addMessageToBuffer()` en su lugar

### 3. **Modificado: `lib/message-buffer.ts`**
La función `flushMessageBuffer()` ahora:
- Importa dinámicamente `processUserBuffer` desde `whatsapp.tsx` para evitar circular dependency
- Ejecuta el procesamiento automáticamente cuando expira el timer

## Ventajas de esta Solución

✅ **Fluidez conversacional**: El LLM ve todos los mensajes en contexto
✅ **Una única respuesta**: No hay múltiples respuestas conflictivas
✅ **Bajo latency**: Solo 2.5 segundos de espera máxima
✅ **Escalable**: Usa Redis, funciona con múltiples instancias
✅ **Agnóstico**: Funciona con cualquier tipo de mensaje (texto, audio, botones)
✅ **Fallback graceful**: Si Redis no está disponible, funciona de forma degradada
✅ **Sin cambios en API**: `processIndividualMessage()` sigue disponible para casos especiales

## Configuración

### Tiempo de debounce (ajustable en `message-buffer.ts`)
```typescript
const BUFFER_DEBOUNCE_MS = 2500 // 2.5 segundos
```

Cambiar según necesidad:
- **Menos latencia**: Reducir a 1000ms (1 segundo)
- **Mejor agregación**: Aumentar a 3000-4000ms

## Monitoreo y Debugging

### Logs importantes

```
[MSG-BUFFER] 🕐 Iniciando timer de debounce para: {phone}
[MSG-BUFFER] ⏳ Agregando a buffer existente: {phone}
[MSG-BUFFER] ✓ Procesando buffer de 3 mensajes para: {phone}
[WHATSAPP] 📦 Procesando buffer de 3 mensajes agregados para {phone}
[WHATSAPP] 💾 Guardando 3 mensajes del buffer en historial
[WHATSAPP] 📨 Mensaje agregado preparado para OpenAI (3 mensajes)
```

## Testing Recomendado

### Caso 1: Mensajes Rápidos (< 2.5s)
1. Abrir WhatsApp Web del usuario de prueba
2. Escribir rápidamente 3-4 mensajes
3. **Esperado:** Una única respuesta coherente que menciona los 3-4 mensajes

### Caso 2: Mensajes Lentos (> 2.5s)
1. Enviar un mensaje
2. Esperar 3 segundos
3. Enviar otro mensaje
4. **Esperado:** Se procesan como 2 conversaciones separadas

### Caso 3: Mezcla (algunos rápidos, luego pausa, luego más)
1. Enviar 2 mensajes rápidamente
2. Se procesan juntos después de 2.5s
3. Enviar otro mensaje mientras se procesa el anterior
4. **Esperado:** Se procesa separadamente (nuevos timers)

## Migración de Código Existente

No hay cambios requeridos en el código existente:
- `processIndividualMessage()` sigue funcionando para casos específicos
- `enqueueUserMessage()` sigue siendo una opción válida
- El webhook automáticamente usa el buffer ahora

## Considerations Futuros

### Mejoras posibles:
- [ ] Agregar configuración por cliente para el tiempo de debounce
- [ ] Dashboard para monitorear buffers activos por usuario
- [ ] Analytics de "mensajes agregados por usuario" 
- [ ] A/B testing: buffer vs. procesamiento individual
- [ ] Soporte para diferentes tipos de agregación (e.g., solo agrupar mensajes de texto, no audios)
