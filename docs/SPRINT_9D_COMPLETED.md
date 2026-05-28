# Sprint 9d Completado - NLU Auxiliar para Detección Inicial

## Estado: ✅ COMPLETADO

Se completó exitosamente el segundo sprint de la nueva arquitectura de detección de pacientes sin recordatorio previo.

---

## Archivos Creados (2 archivos)

### 1. `docs/system-prompts/route_to_initial_contact_nlu.md` (102 líneas)
- **Propósito:** Nuevo prompt de OpenAI para interpretar texto libre
- **Enfoque:** NLU puro - solo extrae intención, NO responde como asistente
- **Intenciones:** 11 tipos diferentes según contexto
- **Salida:** JSON estructurado con intención + confianza + datos extraídos

**Intenciones definidas:**
```
Pacientes Existentes:
- confirm_turn, cancel_turn, book_new_turn, reschedule_turn, general_inquiry

Pacientes Nuevos:
- dni_submission, patient_info, pre_registration_question, abandon

Genéricas:
- farewell, unclear
```

### 2. `lib/conversation-state/patient-detection/intent-extractor.ts` (212 líneas)
- **Función:** Wrapper que llama a Claude con el NLU prompt
- **API:** `extractIntent(message, phone, clientId, context)`
- **Salida:** Estructura `IntentResult` con intención, confianza y datos extraídos
- **Helpers:** 
  - `shouldProcessLocally()` - Define qué intenciones procesa el backend
  - `mapIntentToAction()` - Mapea intención a acción del sistema

---

## Actualización de Archivos

### `lib/conversation-state/index.ts`
- Agregado export para `intent-extractor`

### `lib/conversation-state/patient-detection/patient-flow-integration.ts`
- Importado el extractor de intenciones
- Agregada función `processMessageWithNLU()` para procesar mensajes con IA

---

## Flujo Integrado

```
Sprint 9a detecta paciente
    ↓
Usuario escribe texto libre (no es "1", "2", "3", "4")
    ↓
Sprint 9d NLU extrae intención
    ↓
Backend procesa según intención extraída
```

---

## Ejemplos de Respuesta NLU

### Caso 1: Usuario confirma turno
**Entrada:** "Sí, confirmo"  
**Contexto:** Paciente existente
**Salida:**
```json
{
  "intent": "confirm_turn",
  "confidence": 0.98,
  "extracted_data": {},
  "reasoning": "Confirmación directa del usuario"
}
```

### Caso 2: Usuario proporciona DNI
**Entrada:** "Mi DNI es 12345678"  
**Contexto:** Paciente nuevo
**Salida:**
```json
{
  "intent": "dni_submission",
  "confidence": 0.99,
  "extracted_data": {"dni": "12345678"},
  "reasoning": "DNI extraído claramente"
}
```

### Caso 3: Mensaje vago
**Entrada:** "No sé"  
**Salida:**
```json
{
  "intent": "unclear",
  "confidence": 0.7,
  "extracted_data": {},
  "reasoning": "Usuario no proporciona información útil"
}
```

---

## Compilación

✅ `npm run build` completó exitosamente sin errores

---

## Próximos Pasos

**Sprint 9b:** Flujo de paciente existente (reserva de turnos)  
**Sprint 9c:** Flujo de paciente nuevo (registro + reserva)  
**Sprint 9e:** Integración completa en `whatsapp.tsx`

---

## Notas Técnicas

- **Modelo usado:** Claude 3.5 Sonnet (modelo actual del proyecto)
- **Max tokens:** 500 (suficiente para respuesta JSON)
- **Timeout:** Heredado del cliente Anthropic
- **Error handling:** Fallback automático a OpenAI full router si NLU falla
- **Logging:** Integrado con logger existente del proyecto
