# Plan de Refactorización: Sistema de Estados de Conversación

## Enfoque: Producción Segura con Cambios Progresivos

Este plan está diseñado para un sistema **en producción**. Cada cambio:
- Tiene **feature flag** para activar/desactivar
- Tiene **fallback automático a OpenAI** en caso de error
- Incluye **logging extensivo** para debugging
- Permite **rollback inmediato** sin deploy

---

## Arquitectura de Seguridad

### 1. Feature Flags por Cliente

```typescript
// En la config de WhatsApp de cada cliente
interface DirectFlowConfig {
  // Flags por funcionalidad
  enableDirectConfirmation: boolean      // Confirmación sin OpenAI
  enableDirectCancellation: boolean      // Cancelación sin OpenAI
  enableDirectReschedule: boolean        // Reagendamiento sin OpenAI
  enableDirectFarewell: boolean          // Despedidas anti-repetición
  enableDirectDniExtraction: boolean     // Extracción de DNI
  enableDirectTurnSelection: boolean     // Selección de turnos por número
  
  // Flag maestro
  enableAllDirectFlows: boolean          // Override para activar todo
  
  // Debugging
  logLevel: 'none' | 'basic' | 'verbose' | 'debug'
}
```

### 2. Fallback Automático

```typescript
async function handleWithFallback(
  handler: StateHandler,
  message: string,
  context: ConversationContext,
  config: WhatsAppConfig
): Promise<HandlerResult> {
  try {
    const result = await handler(message, context, config)
    
    if (result.type === 'direct_response') {
      console.log(`[DIRECT-FLOW] Handler exitoso: ${context.phase}`)
      return result
    }
    
    return result
  } catch (error) {
    // Log del error
    console.error(`[DIRECT-FLOW] Error en handler ${context.phase}:`, error)
    
    // Siempre fallback a OpenAI
    return { 
      type: 'delegate_to_openai', 
      context: `[ERROR_FALLBACK] Handler falló: ${error.message}` 
    }
  }
}
```

### 3. Sistema de Logging

```typescript
// Niveles de log
const LOG_LEVELS = {
  none: 0,
  basic: 1,    // Solo transiciones de estado
  verbose: 2,  // + Datos de contexto
  debug: 3     // + Payloads completos
}

function logStateTransition(
  phone: string,
  configId: string,
  from: ConversationPhase,
  to: ConversationPhase,
  trigger: string,
  level: number
) {
  if (level >= LOG_LEVELS.basic) {
    console.log(`[STATE] ${phone} | ${from} -> ${to} | trigger: ${trigger}`)
  }
}
```

---

## Plan de Implementación Progresivo

### Sprint 1: Infraestructura Base (Semana 1)

**Objetivo**: Crear la infraestructura sin cambiar comportamiento existente

#### Tarea 1.1: Modelo de Estado Unificado
**Archivo**: `lib/conversation-state.ts` (refactorizar existente)

```typescript
export type ConversationPhase =
  // Ya implementados (mantener)
  | 'awaiting_cancel_confirmation'
  | 'awaiting_reschedule_choice'
  
  // Nuevos a agregar progresivamente
  | 'idle'
  | 'awaiting_template_response'
  | 'awaiting_discrepancy_response'
  | 'awaiting_dni'
  | 'awaiting_turn_selection'
  | 'post_confirmation'
  | 'post_cancellation'
  | 'farewell_sent'
  // ... más estados en sprints futuros
```

**Criterio de éxito**: 
- Los estados existentes siguen funcionando
- Nuevos estados no afectan flujo actual

#### Tarea 1.2: Feature Flags en Config
**Archivo**: `lib/types.ts` o tabla de config

Agregar campos de configuración por cliente para habilitar/deshabilitar cada feature.

**Criterio de éxito**:
- Admin puede activar/desactivar por cliente
- Default = desactivado (seguro)

#### Tarea 1.3: Logging Framework
**Archivo**: `lib/state-logger.ts`

```typescript
export function logDirectFlow(
  event: string,
  data: Record<string, any>,
  level: 'info' | 'warn' | 'error' = 'info'
) {
  const prefix = '[DIRECT-FLOW]'
  const timestamp = new Date().toISOString()
  console.log(`${prefix} [${timestamp}] ${event}`, 
    level === 'error' ? data : JSON.stringify(data).slice(0, 500))
}
```

**Criterio de éxito**:
- Logs estructurados en producción
- Fácil de filtrar por `[DIRECT-FLOW]`

---

### Sprint 2: Consolidar Flujos Existentes (Semana 2)

**Objetivo**: Integrar los flujos ya implementados (confirmación/cancelación) con el nuevo sistema

#### Tarea 2.1: Migrar appointment-flow-state.ts
Refactorizar para usar `ConversationContext` unificado manteniendo compatibilidad.

**Cambios**:
- Renombrar tipos internos
- Agregar logging
- Agregar feature flag check

**Rollback**: Si falla, el código anterior sigue funcionando

#### Tarea 2.2: Agregar Métricas
Trackear en Redis:
- `direct_flow:confirmations:{clienteId}` - contador
- `direct_flow:cancellations:{clienteId}` - contador
- `direct_flow:fallbacks:{clienteId}` - contador de fallbacks a OpenAI

**Criterio de éxito**:
- Dashboard puede mostrar % de flujos directos vs OpenAI

---

### Sprint 3: Despedidas Anti-Repetición (Semana 3)

**Objetivo**: Mover lógica de "MODO A / MODO B" al backend

#### Problema Actual
El system prompt tiene ~200 líneas para evitar despedidas repetitivas:
```
Si estado.despedida_enviada = true Y el paciente envía agradecimiento:
  -> Respuesta BREVE sin repetir despedida
```

#### Solución Backend

```typescript
// Handler para post-farewell
async function handlePostFarewellMessage(
  message: string,
  context: ConversationContext
): Promise<HandlerResult> {
  // Detectar agradecimiento simple
  const isSimpleThankYou = /^(gracias|ok|dale|bueno|perfecto|listo)$/i.test(message.trim())
  
  if (isSimpleThankYou) {
    return {
      type: 'direct_response',
      message: getRandomBriefResponse(), // "De nada", "A tu orden", etc.
      newPhase: 'farewell_sent' // Mantener estado
    }
  }
  
  // Si es algo más, delegar a OpenAI
  return { type: 'delegate_to_openai' }
}
```

**Feature Flag**: `enableDirectFarewell`

**Logging**:
```
[DIRECT-FLOW] farewell_handler | phone: xxx | input: "gracias" | response: "De nada" | direct: true
```

**Rollback**: Si `enableDirectFarewell: false`, pasa todo a OpenAI

---

### Sprint 4: Selección de Turnos por Número (Semana 4)

**Objetivo**: Manejar respuestas "1", "2", "3" cuando hay opciones presentadas

#### Problema Actual
Cuando OpenAI presenta opciones:
```
1. Lunes 10:00
2. Martes 15:00
3. Miércoles 09:00
```
El usuario responde "2" y OpenAI debe recordar qué era la opción 2.

#### Solución Backend

```typescript
// Guardar opciones en contexto
interface ConversationContext {
  opcionesActuales?: Array<{
    numero: number
    tipo: 'turno' | 'sede' | 'profesional' | 'especialidad'
    id: string
    descripcion: string
  }>
}

// Handler para selección numérica
async function handleNumericSelection(
  message: string,
  context: ConversationContext
): Promise<HandlerResult> {
  const numero = parseInt(message.trim())
  
  if (isNaN(numero) || !context.opcionesActuales) {
    return { type: 'delegate_to_openai' }
  }
  
  const seleccion = context.opcionesActuales.find(o => o.numero === numero)
  
  if (!seleccion) {
    return { type: 'delegate_to_openai' } // Número fuera de rango
  }
  
  // Procesar según tipo
  switch (seleccion.tipo) {
    case 'turno':
      return handleTurnSelected(seleccion, context)
    case 'sede':
      return handleSedeSelected(seleccion, context)
    // etc.
  }
}
```

**Feature Flag**: `enableDirectTurnSelection`

**Dependencia**: OpenAI debe llamar a una función `set_options_context()` cuando presenta opciones

---

### Sprint 5: Extracción de DNI (Semana 5)

**Objetivo**: Extraer y normalizar DNI sin OpenAI

#### Solución Backend

```typescript
function extractDNI(message: string): string | null {
  // Normalizar: quitar puntos, espacios, guiones
  const normalized = message.replace(/[\s.-]/g, '')
  
  // Buscar secuencia de 7-8 dígitos
  const match = normalized.match(/\b(\d{7,8})\b/)
  
  if (match) {
    return match[1]
  }
  
  // Buscar con texto "dni", "documento", etc.
  const withPrefix = message.match(/(?:dni|documento|doc)[:\s]*(\d{7,8})/i)
  if (withPrefix) {
    return withPrefix[1]
  }
  
  return null
}

async function handleAwaitingDNI(
  message: string,
  context: ConversationContext
): Promise<HandlerResult> {
  const dni = extractDNI(message)
  
  if (dni) {
    // Validar contra API
    const paciente = await validarTelefonoPaciente(context.phone, dni, context.configId)
    
    if (paciente.found) {
      return {
        type: 'direct_response',
        message: buildPatientFoundMessage(paciente),
        newPhase: 'awaiting_action_selection'
      }
    }
  }
  
  // Si no se pudo extraer o validar, OpenAI intenta
  return { type: 'delegate_to_openai' }
}
```

**Feature Flag**: `enableDirectDniExtraction`

---

### Sprint 6-8: Flujos de Paciente Nuevo/Existente (Semanas 6-8)

Estos son los más complejos y se abordarán después de validar los sprints anteriores.

---

## Monitoreo y Rollback

### Dashboard de Métricas

```
GET /api/admin/direct-flow-stats?clienteId=xxx

{
  "period": "last_24h",
  "total_messages": 1500,
  "direct_responses": 450,      // 30%
  "openai_responses": 1050,     // 70%
  "fallbacks_from_error": 12,   // 0.8%
  "by_phase": {
    "awaiting_cancel_confirmation": { direct: 89, openai: 3 },
    "farewell_sent": { direct: 156, openai: 45 },
    ...
  }
}
```

### Alertas

```typescript
// Si fallbacks > 5% en última hora, alertar
if (fallbackRate > 0.05) {
  await sendSlackAlert(`[DIRECT-FLOW] Alto rate de fallbacks: ${fallbackRate}%`)
}
```

### Rollback Inmediato

```typescript
// En admin panel o API
POST /api/admin/direct-flow/disable?clienteId=xxx&feature=all

// Efecto inmediato: todos los mensajes pasan a OpenAI
```

---

## Orden de Implementación Recomendado

| # | Sprint | Feature | Riesgo | Beneficio |
|---|--------|---------|--------|-----------|
| 1 | S1 | Infraestructura | Bajo | Base para todo |
| 2 | S2 | Consolidar existente | Bajo | Ya funciona |
| 3 | S3 | Despedidas | Bajo | ~200 líneas menos |
| 4 | S4 | Selección numérica | Medio | Mayor consistencia |
| 5 | S5 | Extracción DNI | Medio | ~100 líneas menos |
| 6 | S6-8 | Paciente nuevo/existente | Alto | ~1500 líneas menos |

---

## Checklist por Sprint

### Antes de deployar:
- [ ] Feature flag existe y está OFF por default
- [ ] Logging implementado
- [ ] Fallback a OpenAI funciona
- [ ] Tests locales pasando
- [ ] Documentación actualizada

### Después de deployar:
- [ ] Activar para 1 cliente de prueba
- [ ] Monitorear logs por 24h
- [ ] Verificar métricas de fallback
- [ ] Si OK, activar para más clientes gradualmente

### Si hay problemas:
- [ ] Desactivar feature flag inmediatamente
- [ ] Revisar logs de errores
- [ ] Crear issue con reproducción
- [ ] Fix y repetir ciclo

---

## Próximo Paso Inmediato

**Sprint 1, Tarea 1.1**: Refactorizar `lib/appointment-flow-state.ts` para:
1. Agregar logging estructurado
2. Preparar para feature flags
3. Documentar estados actuales

Quieres que empecemos con esta tarea?
