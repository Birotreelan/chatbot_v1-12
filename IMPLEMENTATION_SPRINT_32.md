# GUÍA DE INTEGRACIÓN: OPTION DETECTION EN CONTEXTOS ESPECÍFICOS

## 1. Detección de Opciones en Paciente Existente con 1 Turno

### Caso de Uso
Usuario tiene 1 turno confirmado y puede:
1. Confirmar turno
2. Cambiar/Reagendar
3. Cancelar turno

### Implementación

```typescript
import { detectMenuOptionSelection, MenuOption } from "@/lib/conversation-state/option-detection-handler"

// En patient-templates.ts o similar
export function buildSingleTurnoGreeting(patientName: string, turnDetails: string): {
  message: string
  options: MenuOption[]
} {
  const options: MenuOption[] = [
    { index: 0, label: "Confirmar turno", action: "confirm_appointment" },
    { index: 1, label: "Cambiar/Reagendar", action: "reschedule_appointment" },
    { index: 2, label: "Cancelar turno", action: "cancel_appointment" },
  ]

  const message = \`Hola \${patientName}.\n\nTienes un turno confirmado:\n\${turnDetails}\n\n¿Qué querés hacer?\n\n1. Confirmar turno\n2. Cambiar/Reagendar\n3. Cancelar turno\`

  return { message, options }
}

// En whatsapp.tsx, cuando el usuario responde
const { message: botMessage, options } = buildSingleTurnoGreeting(...)

// Guardar opciones en Redis para uso posterior
await redis.setex(\`menu_options:\${configId}:\${userPhone}\`, 600, JSON.stringify(options))

// Cuando llega respuesta del usuario
const menuOptions = await redis.get(\`menu_options:\${configId}:\${userPhone}\`)
const detection = detectMenuOptionSelection(userMessage, JSON.parse(menuOptions))

if (detection.detected && detection.selectedOption) {
  // El usuario seleccionó una opción
  const action = detection.selectedOption.action
  
  switch (action) {
    case "confirm_appointment":
      // Procesar confirmación
      break
    case "reschedule_appointment":
      // Iniciar flujo de reagendamiento
      break
    case "cancel_appointment":
      // Iniciar doble confirmación de cancelación
      break
  }
}
```

## 2. Detección en Búsqueda de Turnos (Sede/Turno)

### Caso de Uso
Usuario quiere buscar turnos y puede elegir entre:
1. Buscar por tipo de turno
2. Buscar por sede

### Implementación

```typescript
const searchOptions: MenuOption[] = [
  { 
    index: 0, 
    label: "Buscar por tipo de turno", 
    action: "search_by_appointment_type",
    details: "Ej: Consulta general, Odontología"
  },
  { 
    index: 1, 
    label: "Buscar por sede", 
    action: "search_by_location",
    details: "Ej: Centro, San Isidro"
  },
]

// Usuario escribe cualquiera de estos y será detectado:
// "1" → search_by_appointment_type
// "primer opción" → search_by_appointment_type
// "tipo de turno" → search_by_appointment_type
// "2" → search_by_location
// "por sede" → search_by_location
// "sede" → search_by_location
```

## 3. Detección en Multi-Paciente (Familiar)

### Caso de Uso
Usuario puede agendar para:
1. Para ti mismo/a
2. Para otra persona

### Implementación

```typescript
const multiPatientOptions: MenuOption[] = [
  { 
    index: 0, 
    label: "Para ti mismo/a", 
    action: "book_for_self",
  },
  { 
    index: 1, 
    label: "Para otro/a", 
    action: "book_for_family",
  },
]

// Usuario puede escribir:
// "1" → Detecta "Para ti mismo/a"
// "yo" → Fuzzy match → "Para ti mismo/a" (si confianza >= 0.65)
// "2" → Detecta "Para otro/a"
// "familiar" → Text match → "Para otro/a"
// "otro" → Text match → "Para otro/a"
```

## 4. Integración en Doble Confirmación de Cancelación

### Implementación (Ya integrada)

```typescript
import { detectConfirmationOrCancellationOptionSelection } from "@/lib/conversation-state/option-detection-handler"

// El helper detecta automáticamente en el contexto de cancelación
// Opciones implícitas:
// 1. Sí, cancelar el turno
// 2. No, mantener el turno

const result = detectConfirmationOrCancellationOptionSelection(userMessage)

if (result.action === "cancel") {
  // Usuario confirmó cancelación
  // Procesar cancelación
}

if (result.action === "confirm") {
  // Usuario eligió mantener turno
  // Volver al menú anterior
}

// El usuario puede escribir CUALQUIERA de estos y será detectado:
// "1", "sí", "cancelar", "si que cancele" → action: "cancel"
// "2", "no", "mantener", "no cancelar" → action: "confirm"
```

## 5. Patrones de Detección por Layer

### Layer 1: Números Directos (HIGH confidence)
```
"2" → Opción index 1 (0-based)
"1" → Opción index 0
```

### Layer 2: Números en Letras (HIGH confidence)
```
"dos" → Opción index 1
"uno" → Opción index 0
"tercero" → Opción index 2
```

### Layer 3: Ordinales (HIGH confidence)
```
"segundo" → Opción index 1
"primera" → Opción index 0
"último" → Última opción
```

### Layer 4: Posicionales (HIGH confidence)
```
"primero", "primera" → index 0
"último", "última" → última opción
```

### Layer 5: Text Matching (HIGH confidence)
```
Opciones:
  1. "Cancelar turno"
  2. "Confirmar"
  3. "Reagendar"

Usuario: "quiero cancelar"
→ Busca "cancelar" en labels
→ Coincide con "Cancelar turno"
→ Detectado: index 0, confidence HIGH
```

### Layer 6: Fuzzy Matching (MEDIUM confidence)
```
Opciones:
  1. "Cancelar"
  2. "Reagendar"

Usuario: "canselr" (typo)
→ Levenshtein distance: 1
→ Similarity: ~0.85
→ Threshold: 0.65
→ Detectado: index 0, confidence MEDIUM
```

## 6. Manejo de No-Detección

### Caso: Usuario no selecciona opción clara

```typescript
const result = detectMenuOptionSelection(message, options)

if (!result.detected) {
  // No se detectó opción, opciones:
  
  // A) Pedir aclaración
  console.log(result.reason)
  // "No se detectó selección en el mensaje"
  
  // B) Mostrar opciones nuevamente
  const menuString = buildMenuString(options)
  await sendMessage(\`No entendí. ¿Cuál preferís?\n\n\${menuString}\`)
  
  // C) Usar NLU si es disponible
  const nluResult = await classifyWithNLU(message)
}
```

## 7. Logging y Debugging

```typescript
const result = detectMenuOptionSelection(message, options, userPhone, configId)

if (result.detected) {
  console.log("[v0] Option detection succeeded", {
    message,
    selectedLabel: result.selectedOption?.label,
    matchType: result.matchType,  // "text_match", "fuzzy_match", etc.
    confidence: result.confidence, // "high", "medium", "low"
    reason: result.reason,
  })
}
```

## 8. Performance Tips

✅ **Store menu options in Redis** with TTL de 5-10 min
✅ **Reuse SelectionOption objects** - no crear nuevas cada vez
✅ **Batch multiple detections** si tienes varios menús
✅ **Log matchType** para monitoring en producción

```typescript
// ❌ MAL: crear opciones cada vez
const result = detectMenuOptionSelection(message, [
  { index: 0, label: "Opción 1", action: "action1" },
  { index: 1, label: "Opción 2", action: "action2" },
])

// ✅ BIEN: reutilizar opciones
const cachedOptions = await getMenuOptionsFromCache(userPhone)
const result = detectMenuOptionSelection(message, cachedOptions)
```

## 9. Integración con NLU

Si la Option Detection NO detecta (layer 1-5 fallan), el sistema tiene fallback a NLU:

```typescript
// En direct-confirmation-handler.ts
const optionDetectionResult = detectConfirmationOrCancellationOptionSelection(message)
if (optionDetectionResult.action) {
  // ✅ Detectado en Layer 1 (Option Detection)
  return { detected: true, action: optionDetectionResult.action }
}

// Si no detecta en Layer 1, continúa con Layers 2-3 (Regex + NLU)
if (isDirectConfirmationPattern(message)) {
  // ✅ Detectado en Layer 2 (Regex)
  return { detected: true, action: "confirm" }
}

// Fallback a NLU para casos muy ambiguos
const nluResult = await classifyDirectActionWithNLU(message)
```

## 10. Casos de Éxito SPRINT 32

### Antes: "No que número poner quiero cancelar el turno de mañana para otro día"
- ❌ Sistema: "¿Qué número?" (No detectaba intención)

### Ahora: "No que número poner quiero cancelar el turno de mañana para otro día"
- ✅ Capa 1: Encuentra "cancelar" en opciones disponibles
- ✅ Confianza: HIGH
- ✅ Sistema: "Confirmás que querés cancelar?"

---

**Recomendación:** Revisar tu flujo actual e identificar dónde hay menús con opciones para integrar option-detection y mejorar UX de los usuarios.
