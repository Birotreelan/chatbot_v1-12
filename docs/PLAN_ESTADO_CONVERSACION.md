# Plan de Refactorización: Sistema de Estados de Conversación

## Resumen Ejecutivo

Actualmente, la lógica del chatbot está distribuida en 4 system prompts que suman **~6700 líneas** de texto. OpenAI debe "recordar" e interpretar decenas de flags de estado y reglas de comportamiento en cada turno, lo que genera:

1. **Inconsistencia**: OpenAI no siempre sigue las reglas
2. **Costos elevados**: Decisiones determinísticas pasan por LLM
3. **Dificultad de debugging**: No hay visibilidad del estado actual
4. **Mantenimiento complejo**: Cambios requieren editar prompts largos

**Objetivo**: Mover la lógica determinística al backend con un sistema de estados explícitos en Redis, reduciendo los prompts a ~30% de su tamaño actual y mejorando fiabilidad.

---

## Análisis de System Prompts Actuales

### 1. asst_router (3350 líneas)
**Función**: Router principal - confirmación, cancelación, derivación

**Estados implícitos identificados (18+)**:
- `estado.plantilla_respondida`
- `estado.confirmacion_asistencia_procesada`
- `estado.esperando_confirmacion_cancelacion_boton`
- `estado.esperando_confirmacion_cancelacion` (texto libre)
- `estado.esperando_opcion_reagendamiento`
- `estado.esperando_respuesta_discrepancia_recordatorio`
- `estado.esperando_seleccion_turno`
- `estado.esperando_dni_para_recordatorio`
- `estado.esperando_respuesta_plantilla_texto`
- `estado.despedida_enviada`
- `estado.persona_equivocada`
- `estado.paciente_nuevo`
- `estado.datos_obtenidos_por_validacion`
- `estado.turno_cancelado_desde_recordatorio`
- `estado.tipo_confirmacion`
- `estado.turno_a_cancelar`
- `estado.ultimo_turno_cancelado`
- `estado.ultimo_turno_datos`

**Lógica determinística que puede moverse al backend**:
- Detección de botones "Confirmar" / "Cancelar"
- Doble confirmación de cancelación (respuestas "1" / "2")
- Ofrecimiento de reagendamiento post-cancelación
- Despedidas anti-repetición (MODO A / MODO B)
- Detección de persona equivocada
- Menú de 4 opciones de discrepancia
- Extracción y normalización de DNI

### 2. route_to_reagendamiento (1136 líneas)
**Función**: Flujo de reagendamiento post-cancelación

**Estados implícitos identificados (8+)**:
- `estado.turno_ya_reservado`
- `estado.esperando_confirmacion_reserva`
- `estado.esperando_obra_social_paciente_nuevo`
- `estado.esperando_seleccion_turno`
- `estado.opciones_actuales`
- `estado.turno_seleccionado`
- `estado.id_turno_reservado`
- `estado.ultimo_turno_datos`

**Lógica determinística que puede moverse al backend**:
- Clasificación de intent post-reserva (Categoría A/B/C)
- Detección de selección de turno por número
- Guardia post-reserva (una sola reserva por sesión)
- Mapeo de número a turno (evitar off-by-one)

### 3. route_to_pacienteExistente (1107 líneas)
**Función**: Agendamiento para pacientes ya registrados

**Estados implícitos identificados (10)**:
- `estado.esperando_obra_social_paciente_existente`
- `estado.esperando_seleccion_obra_social`
- `estado.esperando_seleccion_sede`
- `estado.esperando_opcion_busqueda_paciente_existente`
- `estado.esperando_seleccion_especialidad`
- `estado.esperando_nombre_profesional`
- `estado.esperando_seleccion_profesional`
- `estado.esperando_seleccion_turno_reserva`
- `estado.esperando_email_paciente_existente`
- `estado.esperando_confirmacion_reserva`

**Lógica determinística que puede moverse al backend**:
- Flujo secuencial completo (10 pasos)
- Detección de selección por número
- Validación de obra social
- Contexto de últimas opciones presentadas

### 4. route_to_pacienteNuevo (1145 líneas)
**Función**: Registro y agendamiento de pacientes nuevos

**Estados implícitos identificados (10)**:
- `estado.esperando_nombre_apellido_paciente_nuevo`
- `estado.esperando_obra_social_paciente_nuevo`
- `estado.esperando_seleccion_obra_social`
- `estado.esperando_seleccion_sede`
- `estado.esperando_opcion_busqueda_paciente_nuevo`
- `estado.esperando_seleccion_especialidad`
- `estado.esperando_nombre_profesional`
- `estado.esperando_seleccion_profesional`
- `estado.esperando_seleccion_turno_reserva`
- `estado.esperando_email_paciente_nuevo`
- `estado.esperando_confirmacion_reserva`

**Lógica determinística que puede moverse al backend**:
- Flujo secuencial completo (10 pasos)
- Extracción de nombre/apellido
- Todo lo mismo que pacienteExistente + recopilación de datos

---

## Modelo de Estado Propuesto

### ConversationState Unificado

```typescript
// lib/conversation-state.ts

export type AssistantType = 
  | 'router'           // asst_router
  | 'reagendamiento'   // route_to_reagendamiento
  | 'paciente_nuevo'   // route_to_pacienteNuevo
  | 'paciente_existente' // route_to_pacienteExistente

export type ConversationPhase =
  // === ROUTER (asst_router) ===
  | 'idle'                              // Sin flujo activo
  | 'awaiting_template_response'        // Recordatorio enviado, esperando respuesta
  | 'awaiting_cancel_confirmation'      // Botón Cancelar presionado, esperando "1" o "2"
  | 'awaiting_reschedule_choice'        // Post-cancelación, esperando si quiere reagendar
  | 'awaiting_discrepancy_response'     // Datos discrepantes, esperando 1/2/3/4
  | 'awaiting_dni'                      // Esperando que ingrese DNI
  | 'awaiting_turn_selection'           // Múltiples turnos, eligiendo cuál gestionar
  | 'awaiting_action_selection'         // Turnos mostrados, esperando 1/2/3
  | 'post_confirmation'                 // Turno ya confirmado en esta sesión
  | 'post_cancellation'                 // Turno ya cancelado en esta sesión
  | 'wrong_person'                      // Persona equivocada confirmada
  | 'farewell_sent'                     // Despedida enviada (anti-repetición)
  
  // === REAGENDAMIENTO ===
  | 'reagendamiento_searching'          // Buscando turnos disponibles
  | 'reagendamiento_awaiting_selection' // Lista mostrada, esperando número
  | 'reagendamiento_awaiting_email'     // Email requerido antes de reservar
  | 'reagendamiento_awaiting_confirmation' // Datos mostrados, esperando "sí"
  | 'reagendamiento_completed'          // Turno reservado exitosamente
  
  // === PACIENTE NUEVO ===
  | 'nuevo_awaiting_name'               // Esperando nombre y apellido
  | 'nuevo_awaiting_obra_social'        // Esperando obra social
  | 'nuevo_awaiting_obra_social_selection' // Múltiples OS, esperando selección
  | 'nuevo_awaiting_sede_selection'     // Esperando selección de sede
  | 'nuevo_awaiting_search_option'      // Esperando 1/2/3 (profesional/especialidad/cualquiera)
  | 'nuevo_awaiting_specialty_selection'// Esperando selección de especialidad
  | 'nuevo_awaiting_professional_name'  // Esperando nombre del profesional
  | 'nuevo_awaiting_professional_selection' // Múltiples profesionales, esperando selección
  | 'nuevo_awaiting_turn_selection'     // Lista de turnos mostrada
  | 'nuevo_awaiting_email'              // Email requerido
  | 'nuevo_awaiting_confirmation'       // Datos mostrados, esperando "sí"
  | 'nuevo_completed'                   // Turno reservado
  
  // === PACIENTE EXISTENTE ===
  | 'existente_awaiting_obra_social'
  | 'existente_awaiting_obra_social_selection'
  | 'existente_awaiting_sede_selection'
  | 'existente_awaiting_search_option'
  | 'existente_awaiting_specialty_selection'
  | 'existente_awaiting_professional_name'
  | 'existente_awaiting_professional_selection'
  | 'existente_awaiting_turn_selection'
  | 'existente_awaiting_email'
  | 'existente_awaiting_confirmation'
  | 'existente_completed'

export interface ConversationContext {
  // Identificación
  phase: ConversationPhase
  assistant: AssistantType
  
  // Datos del paciente
  paciente?: {
    id?: string
    dni?: string
    telefono?: string
    nombre?: string
    apellido?: string
    email?: string
    obraSocial?: string
    obraSocialId?: string
    esNuevo: boolean
  }
  
  // Datos del turno en contexto
  turno?: {
    id?: string
    fecha?: string
    hora?: string
    profesionalId?: string
    profesionalNombre?: string
    sedeId?: string
    sedeNombre?: string
    admiteReagendamiento?: boolean
    estado?: string
  }
  
  // Opciones mostradas al usuario (para resolver selecciones)
  opcionesActuales?: Array<{
    numero: number
    tipo: 'turno' | 'sede' | 'especialidad' | 'profesional' | 'obra_social'
    datos: Record<string, any>
  }>
  
  // Flags de sesión
  despedidaEnviada: boolean
  turnoConfirmado: boolean
  turnoCancelado: boolean
  turnoReservado: boolean
  
  // Metadata
  configId: string
  lastUpdated: string
}
```

### Estructura en Redis

```
conversation:{phone}:{configId}:state  -> JSON de ConversationContext
conversation:{phone}:{configId}:ttl    -> 24 horas
```

---

## Plan de Implementación por Fases

### Fase 1: Infraestructura Base (1-2 días)
**Objetivo**: Crear el sistema de estados sin modificar flujos existentes

**Archivos a crear**:
- `lib/conversation-state.ts` - Tipos y funciones CRUD de estado
- `lib/state-handlers/index.ts` - Registry de handlers por fase

**Cambios**:
- Refactorizar `lib/appointment-flow-state.ts` existente para usar el nuevo modelo

### Fase 2: Router - Flujos de Botones (2-3 días)
**Objetivo**: Mover confirmación/cancelación directa al backend

**Ya implementado parcialmente**:
- Confirmación directa (sin OpenAI)
- Doble confirmación de cancelación
- Ofrecimiento de reagendamiento

**Pendiente**:
- Integrar con ConversationContext unificado
- Agregar handler para respuestas "1"/"2" en `awaiting_reschedule_choice`
- Agregar handler para menú de 4 opciones de discrepancia

### Fase 3: Router - Despedidas y Post-Acción (1-2 días)
**Objetivo**: Manejar despedidas anti-repetición desde backend

**Handlers a implementar**:
- `handleFarewellMode()` - Detectar si ya hubo despedida
- `handlePostConfirmationMessage()` - Respuestas breves post-confirmación
- `handlePostCancellationMessage()` - Respuestas breves post-cancelación

**Beneficio**: Eliminar ~200 líneas del system prompt de reglas anti-repetición

### Fase 4: Router - DNI y Validación (2-3 días)
**Objetivo**: Normalización de DNI en backend

**Handlers a implementar**:
- `extractAndValidateDNI()` - Regex robusto para extraer DNI
- `handleAwaitingDNI()` - Procesar respuesta con DNI

**Beneficio**: Eliminar ~100 líneas de reglas de extracción de DNI

### Fase 5: Reagendamiento - Flujo Completo (3-4 días)
**Objetivo**: Manejar todo el flujo de reagendamiento desde backend

**Handlers a implementar**:
- `handleTurnSelection()` - Detectar número y mapear a turno
- `handleReagendamientoConfirmation()` - Procesar "sí"
- `handlePostReservationGuard()` - Clasificación A/B/C

**Beneficio**: Eliminar ~600 líneas del prompt de reagendamiento

### Fase 6: Paciente Nuevo/Existente - Flujos Secuenciales (4-5 días)
**Objetivo**: Manejar los 10 pasos de cada flujo

**Handlers a implementar**:
- `handleObraSocialValidation()`
- `handleSedeSelection()`
- `handleSearchOptionSelection()`
- `handleSpecialtySelection()`
- `handleProfessionalSelection()`
- `handleEmailCapture()`
- `handleReservationConfirmation()`

**Beneficio**: Eliminar ~1500 líneas de los prompts de paciente nuevo/existente

### Fase 7: Reducción de System Prompts (2-3 días)
**Objetivo**: Simplificar prompts a tono y casos edge

**Contenido que queda en prompts**:
- Tono y personalidad
- Interpretación de lenguaje natural ambiguo
- Manejo de cirugías (turnos_qx)
- Casos edge no cubiertos

**Estimación de reducción**:
- asst_router: 3350 → ~800 líneas
- route_to_reagendamiento: 1136 → ~300 líneas
- route_to_pacienteNuevo: 1145 → ~400 líneas
- route_to_pacienteExistente: 1107 → ~400 líneas
- **Total: 6738 → ~1900 líneas (72% reducción)**

---

## Arquitectura de Handlers

```typescript
// lib/state-handlers/types.ts

export type HandlerResult = 
  | { type: 'direct_response', message: string, newPhase?: ConversationPhase }
  | { type: 'delegate_to_openai', context?: string }
  | { type: 'route_to_assistant', assistant: AssistantType, data: any }
  | { type: 'execute_action', action: string, params: any }

export type StateHandler = (
  message: string,
  context: ConversationContext,
  config: WhatsAppConfig
) => Promise<HandlerResult>
```

```typescript
// lib/state-handlers/router-handlers.ts

export const routerHandlers: Record<ConversationPhase, StateHandler> = {
  'awaiting_cancel_confirmation': handleCancelConfirmation,
  'awaiting_reschedule_choice': handleRescheduleChoice,
  'awaiting_discrepancy_response': handleDiscrepancyResponse,
  'farewell_sent': handlePostFarewellMessage,
  // ... etc
}
```

### Flujo de Procesamiento

```
1. Mensaje llega a handleMessage()
2. Cargar ConversationContext de Redis
3. Buscar handler para context.phase
4. Si handler existe:
   - Ejecutar handler
   - Si retorna 'direct_response': enviar mensaje, actualizar estado
   - Si retorna 'delegate_to_openai': pasar a OpenAI con contexto
   - Si retorna 'route_to_assistant': cambiar asistente
5. Si no hay handler: delegar a OpenAI
```

---

## Métricas de Éxito

1. **Reducción de prompts**: 72% menos líneas
2. **Consistencia**: 100% de respuestas determinísticas son idénticas
3. **Costos**: ~40-60% reducción en tokens de OpenAI
4. **Latencia**: Respuestas directas en <500ms (vs ~2s con OpenAI)
5. **Debugging**: Dashboard con estado actual de cada conversación

---

## Próximos Pasos Inmediatos

1. **Revisar y aprobar** este plan
2. **Priorizar** qué flujos atacar primero (sugiero: Fase 1-3 juntas)
3. **Definir** formato exacto de logs para debugging
4. **Crear** tests para handlers críticos

---

## Riesgos y Mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Regresiones en flujos existentes | Tests exhaustivos, rollback rápido |
| Edge cases no cubiertos | Fallback a OpenAI para casos desconocidos |
| Complejidad de migración | Migración gradual por fase |
| Estado inconsistente en Redis | TTL + limpieza automática |
