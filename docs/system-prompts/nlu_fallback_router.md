# NLU Fallback Router - System Prompt

**Sprint 18**: Sistema de clasificación inteligente para mensajes ambiguos cuando no hay regexes claros

## Contexto

Cuando un usuario envía un mensaje a través de WhatsApp después de recibir un recordatorio de turno, el sistema ejecuta una cascada de handlers especializados:

1. **Sprint 15**: Silencio en respuestas recíprocas (regex puro)
2. **Sprint 14**: Confirmación/Cancelación directa (regex puro + NLU para ambigüedad)
3. **Sprint 16**: Consultas informativas (regex puro)
4. **Sprint 17**: Contexto post-acción (regex puro + NLU)
5. **Sprint 12**: Despedidas pre-flujo (regex puro)
6. **Sprint 13**: Número equivocado (regex puro)
7. **★ SPRINT 18**: NLU Fallback Router (NUEVO)
8. **Sprint 9a**: Detección de paciente (flujo default)

El problema: algunos mensajes generan **falsos positivos** en los handlers regex, especialmente en Sprint 16 (Consultas Informativas) debido a patrones demasiado amplios.

## Solución: NLU Fallback Inteligente

Cuando **ningún handler anterior matchea con alta confianza**, este handler NLU actúa como "referee inteligente" para clasificar la intención real y redirigir correctamente.

## Casos de Uso

### Caso 1: False Positive de Consulta de Fecha
**Mensaje**: "Si estaré ede dia"
- Sprint 16 detecta: `FECHA_QUERY` (por "ede dia" → "día")
- NLU reclasifica: `CONFIRMAR_ASISTENCIA` (intención real)
- **Acción**: Responder confirmación, no consulta de fecha

### Caso 2: Queja con Deseo de Acción
**Mensaje**: "Buenas tardes estuve 3 dias de la semana pasada tratando de comunicarme para avisar que por motivos de salud tenia que cambiar el turno .fue imposible nunuca me atendieron en distintas horas."
- Sprint 16 detecta: Podría ser `CONSULTA_INFORMATIVA` (contiene "dias")
- NLU reclasifica: `QUEJA_FRUSTRACION` + `DESEO_CANCELAR/REAGENDAR`
- **Acción**: Responder empáticamente + ofrecer opciones de acción

### Caso 3: Explicación Contextual
**Mensaje**: "Sobre todo por si alguna persona lo necesitaba."
- Ningún handler anterior matchea
- NLU clasifica: `EXPLICACION_CONTEXTUAL`
- **Acción**: Responder empáticamente sin reiniciar flujo

## Intenciones Clasificables

```
confirmar_asistencia     → El paciente confirma que irá (con o sin typos/confusión)
cancelar_turno           → El paciente quiere cancelar
reagendar_turno          → El paciente quiere cambiar fecha/hora
consulta_informativa     → El paciente pregunta detalles del turno que TENEMOS (dirección, hora, profesional)
consulta_no_disponible   → El paciente pregunta algo que NO podemos responder (costos, pagos, cobertura)
queja_frustracion        → El paciente expresa frustración/problema comunicacional
explicacion_contextual   → Explicación de motivo sin acción clara (enfermedad, mudanza)
saludo_despedida         → Simple saludo/despedida
numero_equivocado        → Señala que no es la persona buscada
otro                     → No encaja en ninguna → Continuar flujo normal
```

### Consulta No Disponible (NUEVO)
**Ejemplos:**
- "¿Cuánto cuesta la consulta?"
- "¿Se debe abonar algo al momento de la consulta?"
- "¿Aceptan tarjeta?"
- "¿Qué documentación tengo que llevar?"
- "¿Tienen estacionamiento?"
- "¿Cubren PAMI?"

**Respuesta**: GPT genera respuesta empática + se agrega derivación al número de la clínica (`config.escalationPhoneNumber`)

**Ejemplo de respuesta final:**
```
Esa información no la tengo disponible desde este canal.

Para esa consulta te recomiendo comunicarte directamente con la clínica al *011-4555-1234*.

Tu turno sigue confirmado para el *lunes, 2 de junio de 2026* a las *14:00* con NICOLI MANUEL en SALUD OCULAR CALLAO.

Si necesitás algo más respecto al turno, no dudes en escribirme.
```

## Lógica de Clasificación

### Confirmación de Asistencia
**Patrones regex fallback:**
- `\b(confirmo|confirmado|voy|iré|ahi estare|ahí estaré|de acuerdo|ok|dale|listo|si|asistiré|asisto)\b`

**Ejemplos NLU:**
- "Si estaré ede dia" (typo/confusión, pero intención clara)
- "Ahi voy a ir"
- "Dale, la confirmo"
- "Bueno, de acuerdo"

**Regla importante**: Si el mensaje es confuso pero la intención de confirmar es clara → confidence moderado (0.7-0.8)

### Cancelación de Turno
**Patrones regex fallback:**
- `\b(cancelo|cancelado|no puedo|no voy|no asistiré|no pueda)\b`

**Ejemplos NLU:**
- "No puedo ir, me surgió algo"
- "Tengo que cancelar, me enfermé"
- "No voy a poder llegar"

### Queja/Frustración
**Patrones regex fallback:**
- `\b(nunca|imposible|intenté|estuve|3 dias|no atienden|difícil|dificil)\b`

**Ejemplos NLU:**
- "Estuve 3 días tratando de llamar y nunca me atendieron"
- "Es imposible comunicarse"
- "Intenté 10 veces llamar"

**Contexto importante**: Si la queja va acompañada de deseo de acción (cancelar/reagendar), detectar la acción pero notar la frustración en el reasoning.

### Explicación Contextual
**Patrones regex fallback:**
- Neumonía, gripe, enfermedad, internado, mudanza, cambio de obra social

**Ejemplos NLU:**
- "Está con neumonía"
- "Se mudó de ciudad"
- "Cambié de obra social"
- "Por motivos de salud"

### Consulta Informativa
**Patrones regex fallback:**
- `\b(donde|dónde|horario|hora|quién|quien|profesional|dirección|dirección|sede|cuando|cuándo)\b`

**Ejemplos NLU:**
- "¿Donde queda?"
- "¿A qué hora es?"
- "¿Con quién es?"

## Configuración de Parámetros

| Parámetro | Valor | Razón |
|-----------|-------|-------|
| Modelo | `gpt-4o-mini` | Rápido y económico para clasificación |
| Temperature | 0.1 | Queremos clasificación determinística, no creativa |
| Max tokens | 500 | Basta para JSON de respuesta |
| Confidence mínimo | 0.6 | Por debajo, no procesamos |
| Response format | JSON object | Respuestas estructuradas |

## Response Format

```json
{
  "intent": "queja_frustracion",
  "confidence": 0.92,
  "reasoning": "El paciente expresa clara frustración por no poder comunicarse durante 3 días. Menciona deseo de cambiar turno por motivos de salud.",
  "response": "Lamento mucho los inconvenientes que tuviste para comunicarte con nosotros. Entendemos tu frustración y te pedimos disculpas."
}
```

**Importante**: El campo `response` contiene la respuesta empática generada por GPT. El backend agregará automáticamente:
1. Información del turno actual
2. Menú estándar de opciones (1-Confirmar, 2-Cancelar, 3-Solicitar otro)

**Respuesta final enviada al paciente:**
```
Lamento mucho los inconvenientes que tuviste para comunicarte con nosotros. Entendemos tu frustración y te pedimos disculpas.

Veo que tenés un turno programado para el *lunes, 2 de junio de 2026* a las *14:00* con NICOLI MANUEL en SALUD OCULAR CALLAO.

¿En qué te podemos ayudar?

1- Confirmar asistencia al turno médico
2- Cancelar el turno médico
3- Solicitar otro turno médico

Respondé con el número de opción que prefieras.
```

## Flujo de Ejecución

```
Usuario envía mensaje
↓
Sprint 15: ¿Es silencio recíproco? → Si: RESPONDER + PARAR
                                 → No: Continuar
↓
Sprint 14: ¿Es confirmación/cancelación directa (alta confianza)? → Si: PROCESAR + PARAR
                                                                  → No: Continuar
↓
Sprint 16: ¿Es consulta informativa (alta confianza)? → Si: RESPONDER + PARAR
                                                      → No: Continuar
↓
Sprint 17: ¿Es contexto post-acción? → Si: RESPONDER + PARAR
                                    → No: Continuar
↓
Sprint 12: ¿Es despedida pre-flujo? → Si: RESPONDER + PARAR
                                   → No: Continuar
↓
Sprint 13: ¿Es número equivocado? → Si: RESPONDER + PARAR
                                  → No: Continuar
↓
★ SPRINT 18: ¿Hay appointmentContext activo Y mensaje es texto libre?
                → Si: Llamar NLU fallback
                   - Si confidence >= 0.6 Y intent != "otro": PROCESAR + PARAR
                   - Si no: Continuar
                → No: Continuar
↓
Sprint 9a: Detección inicial de paciente (flujo default)
```

## Métricas de Éxito

- Reducir false positives en Sprint 16 (Consultas Informativas)
- Clasificar correctamente al menos 90% de casos ambiguos
- Costo por llamada: ~$0.0001 (una décima de centavo)
- Latencia: ~200-500ms (acceptable para WhatsApp)

## Feature Flag

```typescript
nluFallbackRouter: boolean (default: false)
```

Activar en dashboard:
```
await enableFeature(configId, "nluFallbackRouter")
```
