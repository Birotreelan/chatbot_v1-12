# Analisis de Migracion: System Prompt a Backend

## Resumen Ejecutivo

El system prompt actual tiene **3350+ lineas** con logica de negocio, validaciones, manejo de estados y flujos conversacionales que deberian estar en el backend. Este documento propone una migracion incremental siguiendo el plan de trabajo proporcionado.

---

## Estructura del Codigo Actual

### Archivos Clave Identificados

| Archivo | Proposito | Modificaciones Propuestas |
|---------|-----------|--------------------------|
| `lib/whatsapp.tsx` | Entry point de mensajes WhatsApp | Agregar preprocesamiento |
| `lib/openai-tools.tsx` | Definicion y ejecucion de tools | Agregar tool gating |
| `lib/user-queue.ts` | Cola de mensajes por usuario | Ya implementada |
| `lib/redis.ts` | Cliente Redis | Usar para estados |
| `lib/conversations.ts` | Guardado de conversaciones | Extender con estados |

### Flujo Actual de Mensajes

```
WhatsApp Webhook
     |
     v
handleMessage() [lib/whatsapp.tsx]
     |
     v
enqueueUserMessage() [lib/user-queue.ts]
     |
     v
processIndividualMessage() [lib/whatsapp.tsx]
     |
     v
getAssistantResponse() [lib/openai-tools.tsx]
     |
     v
OpenAI Assistants API (con system prompt gigante)
     |
     v
executeOpenAITool() [lib/openai-tools.tsx]
     |
     v
sendWhatsAppMessage()
```

### Flujo Propuesto

```
WhatsApp Webhook
     |
     v
handleMessage()
     |
     v
+-------------------+
| NUEVO: preprocessMessage() |  <-- Extrae DNI, detecta intent simple
+-------------------+
     |
     v
[Si skipLLM=true] --> executeDirectAction() --> sendWhatsAppMessage()
     |
     v
[Si skipLLM=false]
     |
     v
+-------------------+
| NUEVO: getToolsForState() |  <-- Filtra tools por estado
+-------------------+
     |
     v
+-------------------+
| NUEVO: getReducedSystemPrompt() |  <-- Prompt contextualizado ~1500 tokens
+-------------------+
     |
     v
getAssistantResponse() (con tools filtradas y prompt reducido)
     |
     v
+-------------------+
| NUEVO: isToolCallAllowed() |  <-- Valida tool calls antes de ejecutar
+-------------------+
     |
     v
executeOpenAITool()
     |
     v
+-------------------+
| NUEVO: updateConversationState() |  <-- Persiste nuevo estado en Redis
+-------------------+
     |
     v
sendWhatsAppMessage()
```

---

## 1. Diagnostico del System Prompt Actual

### Problemas Identificados

| Categoria | Problema | Impacto |
|-----------|----------|---------|
| **Logica duplicada** | Validacion de DNI (regex, limpieza de puntos/espacios) en prompt | El LLM puede fallar o interpretar mal |
| **Estados implicitos** | Estados como `esperando_dni`, `esperando_confirmacion` descritos en texto | No hay control real, el LLM puede "saltar" estados |
| **Tool calling sin gating** | Cualquier tool puede ejecutarse en cualquier momento | El LLM puede ejecutar `cancelar_turno` cuando no corresponde |
| **Flujos procedurales** | Pasos numerados (PASO 1, PASO 2, etc.) en texto | El LLM no siempre sigue el orden |
| **Reglas redundantes** | Mismas reglas repetidas con emojis de alerta | Aumenta tokens sin garantizar cumplimiento |

### Tamano del Prompt

- **Tokens estimados**: ~8000-12000 tokens solo en system prompt
- **Reglas criticas**: 20+ secciones marcadas con "MAXIMA PRIORIDAD"
- **Estados implicitos**: 15+ flags de estado descritos en texto

---

## 2. Propuesta de Migracion por Etapas

### ETAPA 1: Fundamentos (1-3 dias)

#### 1.1 Crear Sistema de Estados Explicito

**Archivo: `lib/conversation-state.ts`**

```typescript
// Estados posibles de la conversacion
export type ConversationState = 
  | 'idle'
  | 'esperando_dni'
  | 'validando_paciente'
  | 'esperando_confirmacion_turno'
  | 'esperando_cancelacion_turno'
  | 'esperando_opcion_reagendamiento'
  | 'esperando_confirmacion_cancelacion_boton'
  | 'esperando_respuesta_discrepancia'
  | 'turno_confirmado'
  | 'turno_cancelado'
  | 'persona_equivocada'
  | 'derivado_humano';

export interface ConversationContext {
  state: ConversationState;
  
  // Datos del paciente
  paciente?: {
    id: string;
    dni: string;
    nombre: string;
    apellido: string;
    telefono: string;
    obraSocial?: string;
    obraSocialId?: string;
  };
  
  // Datos del turno actual
  turnoActual?: {
    id: string;
    fecha: string;
    hora: string;
    profesionalId: string;
    profesionalNombre: string;
    sedeId: string;
    sedeName: string;
    admiteReagendamiento: boolean;
  };
  
  // Recordatorio pendiente
  recordatorioPendiente?: {
    turnoId: string;
    procesado: boolean;
    tipo: 'confirmacion' | 'cancelacion';
  };
  
  // Flags de control
  despedidaEnviada: boolean;
  pacienteNuevo: boolean;
  datosObtenidosPorValidacion: boolean;
  
  // Allowed tools para este estado
  allowedTools: string[];
}

// Transiciones de estado validas
export const STATE_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  'idle': ['esperando_dni', 'validando_paciente', 'esperando_confirmacion_turno'],
  'esperando_dni': ['validando_paciente', 'idle'],
  'validando_paciente': ['esperando_confirmacion_turno', 'esperando_cancelacion_turno', 'idle'],
  'esperando_confirmacion_turno': ['turno_confirmado', 'idle'],
  'esperando_cancelacion_turno': ['turno_cancelado', 'esperando_opcion_reagendamiento', 'idle'],
  // ... mas transiciones
};

// Tools permitidas por estado
export const ALLOWED_TOOLS_BY_STATE: Record<ConversationState, string[]> = {
  'idle': ['validar_dni', 'validar_telefono'],
  'esperando_dni': ['validar_dni'],
  'esperando_confirmacion_turno': ['confirmar_turno'],
  'esperando_cancelacion_turno': ['cancelar_turno'],
  'esperando_opcion_reagendamiento': ['route_to_reagendamiento'],
  // ... etc
};
```

#### 1.2 Mover Validacion de DNI al Backend

**Archivo: `lib/dni-utils.ts`**

```typescript
/**
 * Extrae y normaliza un DNI de un mensaje de texto.
 * Implementa la logica que actualmente esta en el system prompt.
 */
export function extractDNI(message: string): { 
  success: boolean; 
  dni?: string; 
  error?: string 
} {
  // Eliminar todo excepto digitos
  const digits = message.replace(/\D/g, '');
  
  // Validar longitud (7 u 8 digitos para DNI argentino)
  if (digits.length === 7 || digits.length === 8) {
    return { success: true, dni: digits };
  }
  
  // Si hay multiples secuencias, buscar la de 7-8 digitos
  const matches = message.match(/\d{7,8}/g);
  if (matches && matches.length > 0) {
    return { success: true, dni: matches[0] };
  }
  
  return { 
    success: false, 
    error: 'No se encontro un DNI valido (7 u 8 digitos)' 
  };
}

/**
 * Detecta si el mensaje contiene un DNI
 */
export function containsDNI(message: string): boolean {
  const digits = message.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 8;
}
```

#### 1.3 Detector de Intenciones Simples

**Archivo: `lib/intent-detector.ts`**

```typescript
export type SimpleIntent = 
  | 'confirmacion'
  | 'cancelacion'
  | 'reagendamiento'
  | 'agradecimiento'
  | 'saludo'
  | 'despedida'
  | 'opcion_1'
  | 'opcion_2'
  | 'opcion_3'
  | 'opcion_4'
  | 'ambiguo'
  | 'persona_equivocada'
  | 'unknown';

interface IntentResult {
  intent: SimpleIntent;
  confidence: 'high' | 'medium' | 'low';
  matchedPattern?: string;
}

const PATTERNS: Record<SimpleIntent, RegExp[]> = {
  confirmacion: [
    /^(si|sí|confirmo|dale|ok|perfecto|claro|por supuesto|asistire|voy|estare)$/i,
    /^1$/,
    /confirmar/i,
  ],
  cancelacion: [
    /^(no|cancelar|no puedo|no voy)$/i,
    /quiero cancelar/i,
    /cancelar (el|mi) turno/i,
    /no (voy|ire|asistire|puedo)/i,
  ],
  agradecimiento: [
    /^(gracias|muchas gracias|mil gracias|te agradezco)$/i,
    /gracias[!.]*$/i,
  ],
  opcion_1: [/^1$/, /^uno$/, /opcion 1/i, /la 1/i],
  opcion_2: [/^2$/, /^dos$/, /opcion 2/i, /la 2/i],
  opcion_3: [/^3$/, /^tres$/, /opcion 3/i, /la 3/i],
  opcion_4: [/^4$/, /^cuatro$/, /opcion 4/i, /la 4/i],
  persona_equivocada: [
    /no soy (la persona|esa persona|yo)/i,
    /numero equivocado/i,
    /se equivocaron de numero/i,
    /no me llamo/i,
    /no es (para mi|mi turno)/i,
    /yo no tengo turno/i,
  ],
  saludo: [/^(hola|buenos dias|buenas tardes|buenas noches|buen dia)$/i],
  despedida: [/^(chau|adios|hasta luego|nos vemos)$/i],
  reagendamiento: [/reagendar/i, /cambiar (el|mi) turno/i, /otra fecha/i],
  ambiguo: [],
  unknown: [],
};

export function detectIntent(message: string): IntentResult {
  const normalized = message.trim().toLowerCase();
  
  for (const [intent, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return {
          intent: intent as SimpleIntent,
          confidence: 'high',
          matchedPattern: pattern.toString(),
        };
      }
    }
  }
  
  return { intent: 'unknown', confidence: 'low' };
}

/**
 * Para intenciones donde NO necesitamos el LLM
 */
export function canHandleWithoutLLM(intent: SimpleIntent, state: ConversationState): boolean {
  const directHandlers: Record<string, SimpleIntent[]> = {
    'esperando_confirmacion_turno': ['confirmacion', 'cancelacion', 'opcion_1', 'opcion_2'],
    'esperando_opcion_reagendamiento': ['opcion_1', 'opcion_2'],
    'esperando_confirmacion_cancelacion_boton': ['confirmacion', 'cancelacion', 'opcion_1', 'opcion_2'],
  };
  
  return directHandlers[state]?.includes(intent) ?? false;
}
```

---

### ETAPA 2: Sacar Logica Critica del Prompt (3-7 dias)

#### 2.1 Tool Gating - Filtrar Tools por Estado

**Modificar: `lib/openai-tools.tsx`**

```typescript
import { ALLOWED_TOOLS_BY_STATE, ConversationState } from './conversation-state';

/**
 * Filtra las tools disponibles segun el estado actual de la conversacion
 */
export function getToolsForState(
  allTools: ChatCompletionTool[],
  state: ConversationState
): ChatCompletionTool[] {
  const allowedNames = ALLOWED_TOOLS_BY_STATE[state] || [];
  
  // Siempre permitir algunas tools basicas
  const alwaysAllowed = ['validar_telefono'];
  const finalAllowed = [...new Set([...allowedNames, ...alwaysAllowed])];
  
  return allTools.filter(tool => 
    finalAllowed.includes(tool.function.name)
  );
}

/**
 * Valida si una tool call es permitida en el estado actual
 */
export function isToolCallAllowed(
  toolName: string, 
  state: ConversationState
): { allowed: boolean; reason?: string } {
  const allowedNames = ALLOWED_TOOLS_BY_STATE[state] || [];
  
  if (allowedNames.includes(toolName)) {
    return { allowed: true };
  }
  
  return { 
    allowed: false, 
    reason: `Tool "${toolName}" no permitida en estado "${state}". Permitidas: ${allowedNames.join(', ')}` 
  };
}
```

#### 2.2 Pre-procesador de Mensajes

**Archivo: `lib/message-preprocessor.ts`**

```typescript
import { extractDNI, containsDNI } from './dni-utils';
import { detectIntent, canHandleWithoutLLM } from './intent-detector';
import { ConversationContext, ConversationState } from './conversation-state';

export interface PreprocessResult {
  // Si true, no necesitamos llamar al LLM
  skipLLM: boolean;
  
  // Respuesta directa (si skipLLM = true)
  directResponse?: string;
  
  // Accion a ejecutar sin LLM
  directAction?: {
    type: 'confirmar_turno' | 'cancelar_turno' | 'route_to_reagendamiento';
    params: Record<string, any>;
  };
  
  // Datos extraidos del mensaje
  extracted: {
    dni?: string;
    intent: string;
    intentConfidence: string;
  };
  
  // Nuevo estado sugerido
  suggestedState?: ConversationState;
  
  // Contexto enriquecido para el LLM (si skipLLM = false)
  enrichedContext?: string;
}

export function preprocessMessage(
  message: string,
  context: ConversationContext
): PreprocessResult {
  const intent = detectIntent(message);
  const dniResult = containsDNI(message) ? extractDNI(message) : null;
  
  const result: PreprocessResult = {
    skipLLM: false,
    extracted: {
      dni: dniResult?.dni,
      intent: intent.intent,
      intentConfidence: intent.confidence,
    },
  };
  
  // Caso 1: Esperando DNI y el usuario envia un DNI
  if (context.state === 'esperando_dni' && dniResult?.success) {
    result.extracted.dni = dniResult.dni;
    result.suggestedState = 'validando_paciente';
    result.enrichedContext = `[BACKEND] DNI extraido: ${dniResult.dni}. Proceder con validar_dni.`;
    return result;
  }
  
  // Caso 2: Esperando confirmacion y el usuario confirma/cancela
  if (context.state === 'esperando_confirmacion_turno') {
    if (intent.intent === 'confirmacion' || intent.intent === 'opcion_1') {
      result.skipLLM = true;
      result.directAction = {
        type: 'confirmar_turno',
        params: {
          Cliente_Id: context.paciente?.id,
          fecha: context.turnoActual?.fecha,
        },
      };
      return result;
    }
    if (intent.intent === 'cancelacion' || intent.intent === 'opcion_2') {
      result.suggestedState = 'esperando_cancelacion_turno';
      result.enrichedContext = '[BACKEND] Usuario solicita cancelacion. Confirmar antes de ejecutar.';
      return result;
    }
  }
  
  // Caso 3: Persona equivocada (detectada por patron)
  if (intent.intent === 'persona_equivocada') {
    result.skipLLM = true;
    result.directResponse = generarRespuestaPersonaEquivocada(context);
    result.suggestedState = 'persona_equivocada';
    return result;
  }
  
  // Caso 4: Agradecimiento despues de despedida
  if (intent.intent === 'agradecimiento' && context.despedidaEnviada) {
    result.skipLLM = true;
    result.directResponse = generarRespuestaBreve(context);
    return result;
  }
  
  return result;
}

function generarRespuestaPersonaEquivocada(context: ConversationContext): string {
  return `Disculpa la molestia. Parece que el recordatorio fue dirigido a un numero equivocado. Vamos a revisar nuestros registros para evitar contactarte nuevamente por este turno.

Si necesitas gestionar un turno propio en otro momento, podes escribirnos por este mismo canal indicando tu DNI y con gusto te ayudamos.

Que tengas un buen dia!`;
}

function generarRespuestaBreve(context: ConversationContext): string {
  const variantes = [
    `A vos, ${context.paciente?.nombre}!`,
    `Un gusto, ${context.paciente?.nombre}!`,
    `Cualquier cosa por aca estoy!`,
    `Genial, ${context.paciente?.nombre}!`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}
```

---

### ETAPA 3: Refactor Arquitectonico (1-2 semanas)

#### 3.1 System Prompt Reducido

El nuevo system prompt deberia ser ~1500 tokens en lugar de ~10000:

```typescript
export function getReducedSystemPrompt(context: ConversationContext): string {
  return `Eres la asistente virtual de una clinica oftalmologica.

## TU ROL
- Interpretas mensajes en lenguaje natural
- Generas respuestas amables y profesionales  
- NO decides acciones: el backend controla el flujo

## ESTADO ACTUAL
- Estado: ${context.state}
- Paciente: ${context.paciente?.nombre || 'No identificado'}
- Turno pendiente: ${context.turnoActual ? 'Si' : 'No'}

## TOOLS DISPONIBLES
Solo podes usar: ${context.allowedTools.join(', ')}

## REGLAS DE COMUNICACION
- Usa el nombre del paciente cuando lo tengas
- Se breve pero cordial
- No repitas despedidas si ya se envio una
- Saludo segun hora: ${getSaludoPorHora()}

## LO QUE NO DEBES HACER
- No ejecutes tools que no esten en la lista permitida
- No asumas estados que no te indico el backend
- No muestres mensajes de exito sin respuesta del backend
`;
}
```

#### 3.2 Flujo de Procesamiento Refactorizado

**Modificar: `lib/whatsapp.tsx` (processIndividualMessage)**

```typescript
export async function processIndividualMessage(
  phone: string,
  message: string,
  config: WhatsAppConfig
) {
  // 1. Obtener contexto de la conversacion
  const context = await getConversationContext(phone, config);
  
  // 2. Pre-procesar mensaje (extrae DNI, detecta intent simple)
  const preprocessed = preprocessMessage(message, context);
  
  // 3. Si se puede resolver sin LLM, hacerlo directamente
  if (preprocessed.skipLLM) {
    if (preprocessed.directAction) {
      await executeDirectAction(preprocessed.directAction, context);
    }
    if (preprocessed.directResponse) {
      await sendWhatsAppMessage(phone, preprocessed.directResponse, config);
    }
    await updateConversationState(phone, preprocessed.suggestedState, config);
    return;
  }
  
  // 4. Preparar tools filtradas por estado
  const allowedTools = getToolsForState(ALL_TOOLS, context.state);
  
  // 5. Preparar system prompt reducido
  const systemPrompt = getReducedSystemPrompt(context);
  
  // 6. Agregar contexto enriquecido al mensaje
  const enrichedMessage = preprocessed.enrichedContext 
    ? `${preprocessed.enrichedContext}\n\nMensaje del usuario: ${message}`
    : message;
  
  // 7. Llamar a OpenAI con tools filtradas
  const response = await callOpenAI({
    systemPrompt,
    message: enrichedMessage,
    tools: allowedTools,
    context,
  });
  
  // 8. Validar tool calls antes de ejecutar
  for (const toolCall of response.toolCalls) {
    const validation = isToolCallAllowed(toolCall.name, context.state);
    if (!validation.allowed) {
      console.warn(`[TOOL-GATING] Bloqueado: ${validation.reason}`);
      continue; // Ignorar tool no permitida
    }
    await executeToolCall(toolCall, context);
  }
  
  // 9. Enviar respuesta
  await sendWhatsAppMessage(phone, response.message, config);
  
  // 10. Actualizar estado
  await updateConversationState(phone, response.newState, config);
}
```

---

## 3. Plan de Implementacion Detallado

### Semana 1: Fundamentos

| Dia | Tarea | Entregable |
|-----|-------|-----------|
| 1-2 | Crear `lib/conversation-state.ts` | Sistema de estados tipado |
| 2-3 | Crear `lib/dni-utils.ts` | Extractor de DNI |
| 3-4 | Crear `lib/intent-detector.ts` | Detector de intenciones simples |
| 4-5 | Integrar en `processIndividualMessage` | Flujo con preprocesamiento |

### Semana 2: Tool Gating y Reduccion de Prompt

| Dia | Tarea | Entregable |
|-----|-------|-----------|
| 1-2 | Implementar tool gating | Tools filtradas por estado |
| 3-4 | Crear `getReducedSystemPrompt()` | Prompt de ~1500 tokens |
| 5 | Testing con casos de uso reales | Suite de pruebas |

### Semana 3-4: Refactor Completo

| Dia | Tarea | Entregable |
|-----|-------|-----------|
| 1-5 | Migrar flujos de recordatorio | Codigo simplificado |
| 6-10 | Migrar flujos de cancelacion/reagendamiento | Codigo simplificado |

---

## 4. Metricas de Exito

| Metrica | Antes | Despues (Objetivo) |
|---------|-------|-------------------|
| Tokens de system prompt | ~10000 | ~1500-2500 |
| Tool calls incorrectas | ~10%? | <1% |
| Loops de conversacion | Frecuentes | Raros |
| Latencia promedio | Variable | -30% |
| Costo por conversacion | Alto | -40% |

---

## 5. Riesgos y Mitigaciones

| Riesgo | Mitigacion |
|--------|------------|
| Regresiones en flujos existentes | Testing exhaustivo antes de deploy |
| El LLM no sigue el prompt reducido | Ajustar prompt iterativamente |
| Estados desincronizados en Redis | TTL y cleanup automatico |

---

## 6. Proximos Pasos Inmediatos

1. **Aprobar este documento** con el equipo
2. **Crear branch** `feature/backend-migration`
3. **Implementar `dni-utils.ts`** (mas simple, menos riesgo)
4. **Implementar `intent-detector.ts`** 
5. **Integrar preprocesamiento** en `processIndividualMessage`
6. **Testing A/B** con subset de usuarios

---

## 7. Codigo de Referencia: Implementacion Inicial

A continuacion se muestra como se verian los archivos nuevos integrados con la estructura existente del proyecto.

### 7.1 `lib/dni-utils.ts` - Implementacion Completa

```typescript
/**
 * Utilidades para extraccion y validacion de DNI argentino.
 * Reemplaza la logica que actualmente esta en el system prompt.
 */

export interface DNIExtractionResult {
  success: boolean;
  dni?: string;
  error?: string;
  rawInput: string;
}

/**
 * Extrae y normaliza un DNI de un mensaje de texto.
 * Maneja formatos como: "13287031", "DNI 13.287.031", "mi dni es 13 287 031"
 */
export function extractDNI(message: string): DNIExtractionResult {
  const rawInput = message;
  
  // Paso 1: Eliminar todo excepto digitos
  const allDigits = message.replace(/\D/g, '');
  
  // Paso 2: Si los digitos son exactamente 7 u 8, es un DNI valido
  if (allDigits.length === 7 || allDigits.length === 8) {
    return { success: true, dni: allDigits, rawInput };
  }
  
  // Paso 3: Si hay mas digitos, buscar secuencias de 7-8 digitos consecutivos
  // Esto maneja casos como "Tengo 2 hijos, mi DNI es 13287031"
  const matches = message.match(/\d[\d\s.,-]*\d/g); // Secuencias que empiezan y terminan con digito
  
  if (matches) {
    for (const match of matches) {
      const digits = match.replace(/\D/g, '');
      if (digits.length === 7 || digits.length === 8) {
        return { success: true, dni: digits, rawInput };
      }
    }
  }
  
  // Paso 4: Caso borde - secuencia exacta de 7-8 digitos en el texto
  const exactMatch = message.match(/\d{7,8}/);
  if (exactMatch) {
    return { success: true, dni: exactMatch[0], rawInput };
  }
  
  return { 
    success: false, 
    error: 'No se pudo identificar un DNI valido (7 u 8 digitos)',
    rawInput 
  };
}

/**
 * Verifica si un mensaje parece contener un DNI
 */
export function containsDNI(message: string): boolean {
  const allDigits = message.replace(/\D/g, '');
  
  // Si tiene entre 7 y 8 digitos en total, probablemente es un DNI
  if (allDigits.length >= 7 && allDigits.length <= 8) {
    return true;
  }
  
  // Buscar secuencia de 7-8 digitos consecutivos
  return /\d{7,8}/.test(message);
}

/**
 * Valida si una cadena es un DNI argentino valido
 */
export function isValidDNI(dni: string): boolean {
  const digits = dni.replace(/\D/g, '');
  return digits.length === 7 || digits.length === 8;
}

/**
 * Formatea un DNI para mostrar al usuario (con puntos)
 */
export function formatDNI(dni: string): string {
  const digits = dni.replace(/\D/g, '');
  if (digits.length === 8) {
    return \`\${digits.slice(0, 2)}.\${digits.slice(2, 5)}.\${digits.slice(5)}\`;
  }
  if (digits.length === 7) {
    return \`\${digits.slice(0, 1)}.\${digits.slice(1, 4)}.\${digits.slice(4)}\`;
  }
  return dni;
}
```

### 7.2 `lib/intent-detector.ts` - Implementacion Completa

```typescript
import type { ConversationState } from './conversation-state';

export type SimpleIntent = 
  | 'confirmacion'
  | 'cancelacion'
  | 'reagendamiento'
  | 'agradecimiento'
  | 'saludo'
  | 'despedida'
  | 'opcion_1'
  | 'opcion_2'
  | 'opcion_3'
  | 'opcion_4'
  | 'persona_equivocada'
  | 'discrepancia_turno'
  | 'unknown';

export interface IntentResult {
  intent: SimpleIntent;
  confidence: 'high' | 'medium' | 'low';
  matchedPattern?: string;
}

// Patrones ordenados por especificidad (mas especifico primero)
const PATTERNS: Array<[SimpleIntent, RegExp, 'high' | 'medium']> = [
  // Persona equivocada (alta prioridad - detectar antes que cancelacion)
  ['persona_equivocada', /no soy (la persona|esa persona|yo)/i, 'high'],
  ['persona_equivocada', /numero equivocado/i, 'high'],
  ['persona_equivocada', /se equivocaron de numero/i, 'high'],
  ['persona_equivocada', /no me llamo/i, 'high'],
  ['persona_equivocada', /no es (para mi|mi turno)/i, 'high'],
  ['persona_equivocada', /yo no tengo turno/i, 'high'],
  ['persona_equivocada', /no soy paciente/i, 'high'],
  
  // Discrepancia de turno
  ['discrepancia_turno', /no es ese dia/i, 'high'],
  ['discrepancia_turno', /esta equivocad[oa]/i, 'high'],
  ['discrepancia_turno', /no es correcto/i, 'high'],
  ['discrepancia_turno', /hay un error/i, 'medium'],
  ['discrepancia_turno', /me figura para otra fecha/i, 'high'],
  
  // Opciones numericas (exactas)
  ['opcion_1', /^1$/, 'high'],
  ['opcion_2', /^2$/, 'high'],
  ['opcion_3', /^3$/, 'high'],
  ['opcion_4', /^4$/, 'high'],
  
  // Confirmaciones
  ['confirmacion', /^(si|sí)$/i, 'high'],
  ['confirmacion', /^(confirmo|confirmar)$/i, 'high'],
  ['confirmacion', /^(dale|ok|perfecto|claro)$/i, 'high'],
  ['confirmacion', /^(por supuesto|estare|asistire|voy)$/i, 'high'],
  ['confirmacion', /confirmar (el |mi )?turno/i, 'high'],
  ['confirmacion', /confirmo (mi )?asistencia/i, 'high'],
  
  // Cancelaciones (cuidado con falsos positivos)
  ['cancelacion', /^(no)$/i, 'medium'], // Solo "no" aislado
  ['cancelacion', /quiero cancelar/i, 'high'],
  ['cancelacion', /cancelar (el |mi )?turno/i, 'high'],
  ['cancelacion', /no (voy|ire|asistire|puedo) (a ir|asistir)?/i, 'high'],
  ['cancelacion', /cancelen(lo)?/i, 'high'],
  
  // Reagendamiento
  ['reagendamiento', /reagendar/i, 'high'],
  ['reagendamiento', /cambiar (el |mi )?turno/i, 'high'],
  ['reagendamiento', /otra fecha/i, 'high'],
  ['reagendamiento', /reprogramar/i, 'high'],
  
  // Agradecimientos
  ['agradecimiento', /^gracias[!.]*$/i, 'high'],
  ['agradecimiento', /^(muchas |mil )?gracias/i, 'high'],
  ['agradecimiento', /^buenisimo[!.]*$/i, 'high'],
  ['agradecimiento', /^genial[!.]*$/i, 'high'],
  ['agradecimiento', /^listo[!.]*$/i, 'medium'],
  
  // Saludos
  ['saludo', /^hola[!.]*$/i, 'high'],
  ['saludo', /^(buenos dias|buenas tardes|buenas noches|buen dia)/i, 'high'],
  
  // Despedidas
  ['despedida', /^(chau|adios|hasta luego|nos vemos)/i, 'high'],
];

export function detectIntent(message: string): IntentResult {
  const normalized = message.trim();
  
  for (const [intent, pattern, confidence] of PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        intent,
        confidence,
        matchedPattern: pattern.toString(),
      };
    }
  }
  
  return { intent: 'unknown', confidence: 'low' };
}

/**
 * Determina si una intencion puede manejarse sin LLM dado el estado actual
 */
export function canSkipLLM(intent: SimpleIntent, state: ConversationState): boolean {
  const skipMap: Record<ConversationState, SimpleIntent[]> = {
    'esperando_confirmacion_turno': ['confirmacion', 'opcion_1'],
    'esperando_cancelacion_turno': ['confirmacion', 'opcion_1', 'cancelacion'],
    'esperando_opcion_reagendamiento': ['opcion_1', 'opcion_2'],
    'esperando_confirmacion_cancelacion_boton': ['confirmacion', 'opcion_1', 'opcion_2'],
    // Estados donde siempre se puede manejar persona_equivocada sin LLM
    'idle': ['persona_equivocada'],
    'esperando_dni': ['persona_equivocada'],
    'validando_paciente': ['persona_equivocada'],
    'turno_confirmado': ['agradecimiento'],
    'turno_cancelado': ['agradecimiento'],
    // Otros estados
    'esperando_respuesta_discrepancia': [],
    'persona_equivocada': [],
    'derivado_humano': [],
  };
  
  return skipMap[state]?.includes(intent) ?? false;
}
```

### 7.3 Integracion en `lib/whatsapp.tsx`

El punto de integracion seria justo despues de extraer el mensaje y antes de llamar a OpenAI:

```typescript
// En processIndividualMessage(), despues de obtener el mensaje
// y antes de llamar a getAssistantResponse()

import { extractDNI, containsDNI } from './dni-utils';
import { detectIntent, canSkipLLM } from './intent-detector';
import { getConversationContext, updateConversationState } from './conversation-state';

// ... codigo existente ...

// NUEVO: Obtener contexto de estado
const context = await getConversationContext(userPhoneNumber, config);

// NUEVO: Pre-procesar mensaje
const intent = detectIntent(userMessage);
console.log(\`[WHATSAPP] Intent detectado: \${intent.intent} (confidence: \${intent.confidence})\`);

// NUEVO: Extraer DNI si aplica
if (context.state === 'esperando_dni' && containsDNI(userMessage)) {
  const dniResult = extractDNI(userMessage);
  if (dniResult.success) {
    console.log(\`[WHATSAPP] DNI extraido por backend: \${dniResult.dni}\`);
    // Enriquecer el mensaje para OpenAI
    userMessage = \`[BACKEND] DNI extraido y validado: \${dniResult.dni}. Proceder con validar_dni usando este DNI.\n\nMensaje original: \${userMessage}\`;
  }
}

// NUEVO: Manejar sin LLM si es posible
if (canSkipLLM(intent.intent, context.state)) {
  console.log(\`[WHATSAPP] Manejando intent \${intent.intent} sin LLM\`);
  const response = await handleDirectIntent(intent, context, config);
  if (response) {
    await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, response);
    await updateConversationState(userPhoneNumber, config, context);
    return;
  }
}

// ... continuar con flujo normal hacia OpenAI ...
```

---

## 8. Resumen de Beneficios

| Aspecto | Antes | Despues |
|---------|-------|---------|
| **Tokens por request** | ~12000 | ~2500 |
| **Control de flujo** | LLM decide | Backend decide |
| **Validacion de DNI** | En prompt (puede fallar) | En codigo (deterministico) |
| **Tool calls** | Cualquier tool en cualquier momento | Solo tools permitidas por estado |
| **Debugging** | Dificil (caja negra) | Facil (logs estructurados) |
| **Mantenimiento** | Editar prompt gigante | Editar codigo modular |
| **Testing** | Manual | Automatizado |
| **Costo** | ~$0.03-0.05/conversacion | ~$0.01-0.02/conversacion |
