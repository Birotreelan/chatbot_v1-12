# Sprint 3: Despedidas Anti-Repetición ✅ COMPLETADO

## Objetivo
Mover la lógica de detección y manejo de despedidas del system prompt al backend, evitando que OpenAI repita despedidas múltiples y reduciendo llamadas innecesarias.

## Problema que resolvemos
Cuando un usuario enviaba múltiples despedidas (ej: "gracias", "ok", "chau"), OpenAI respondía con una despedida completa cada vez, causando loops incómodos.

## Solución Implementada

### 1. Nuevo archivo: `lib/conversation-state/farewell-handler.ts`
**Responsabilidades:**
- Detectar despedidas usando palabras clave
- Mantener estado `farewell_sent` en Redis con TTL de 1 hora
- Diferenciar entre MODO A (cierre completo) y MODO B (cierre breve)

**Lógica:**
```
Primera despedida en 1h → Respuesta completa (MODO A)
                          Guardar state en Redis con TTL 1h
Siguientes despedidas → Respuesta breve (MODO B)
                        Refrescar TTL
Después de 1h sin despedida → Reset automático
```

**Respuestas:**
- MODO A: "Si necesitás algo más, no dudes en escribirme. ¡Hasta luego, [Nombre]!"
- MODO B: "Hasta luego, amigo."

### 2. Integración en `whatsapp.tsx`
**Cambios:**
- Agregado interceptor de despedidas ANTES de enqueueUserMessage
- Si se detecta despedida y flag `antiRepetitionFarewell` está ON:
  - No pasa a OpenAI
  - Responde directamente
  - Guarda estado en Redis
- Si flag está OFF: comportamiento actual (pasa a OpenAI)

**Flujo:**
```
Usuario envía "gracias"
    ↓
¿antiRepetitionFarewell flag = true?
    ├─ SÍ → Detectar despedida → Responder directamente
    └─ NO  → Pasar a OpenAI (comportamiento actual)
```

### 3. Feature Flag
- Nombre: `antiRepetitionFarewell`
- Ubicación: `FeatureFlags` interface en `types.ts`
- Default: `false` (cero cambios en producción)
- Activable por cliente

## Logs para Monitoring
```
[DIRECT-FLOW:farewell-check] Despedida interceptada, respondiendo directamente
[DIRECT-FLOW:farewell-check] MODO A - Primera despedida, enviando cierre completo
[DIRECT-FLOW:farewell-check] MODO B - Despedida repetida, enviando respuesta breve
[DIRECT-FLOW:farewell-check] No es una despedida o antiRepetitionFarewell OFF
```

## Archivos Modificados
- ✅ `lib/conversation-state/farewell-handler.ts` (NUEVO)
- ✅ `lib/whatsapp.tsx` - Interceptor + import
- ✅ `lib/conversation-state/types.ts` - Ya tiene flag `antiRepetitionFarewell`

## TypeScript
- ✅ Compila sin errores

## Comportamiento en Producción
- ✅ Flag desactivado por defecto (cero cambios)
- ✅ Fallback automático a OpenAI si hay error
- ✅ Logging extensivo para debugging
- ✅ Rollback instantáneo (solo desactivar flag)

## Próximos pasos
Cuando esté listo, pasar a **Sprint 4: Selección de Turnos por Número** o continuar con más sprints según prioridad.
