# DIAGRAMA: FLUJO DE DETECCIÓN HÍBRIDA DE OPCIONES (SPRINT 32)

## Flujo Principal de Detección

```
┌─────────────────────────────────────────────────────────────────┐
│                  MENSAJE DEL USUARIO RECIBIDO                   │
│     "No que número poner quiero cancelar el turno de mañana"     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│            VERIFICAR APPOINTMENTCONTEXT EN REDIS                │
│  - ¿Existe contexto de cita reciente (ventana 24h)?            │
│  - ¿Está dentro de ventana de template?                         │
└──────────────────┬──────────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
       SÍ                    NO
        │                     │
        ▼                     ▼
   [CONTINUAR]        [SALIR - Flujo normal]
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│         🆕 CAPA 1: OPTION DETECTION (NEW - SPRINT 32)          │
│                                                                  │
│  detectConfirmationOrCancellationOptionSelection()              │
│                                                                  │
│  Opciones disponibles:                                          │
│    1. Confirmar turno                                           │
│    2. Cambiar/Reagendar                                         │
│    3. Cancelar turno                                            │
│                                                                  │
│  Layers:                                                        │
│    ├─ Layer 1: Números directos? "3" → Opción 3               │
│    ├─ Layer 2: Números en letras? "tres" → Opción 3           │
│    ├─ Layer 3: Ordinales? "tercero" → Opción 3                │
│    ├─ Layer 4: Posicionales? "último" → Opción 3              │
│    ├─ Layer 5: Text match? "cancelar" en "Cancelar turno"     │
│    └─ Layer 6: Fuzzy match? "canselr" ≈ "Cancelar" (0.85)    │
│                                                                  │
│  Entrada: "cancelar el turno de mañana"                        │
│  ✅ DETECTA: "cancelar" en "Cancelar turno"                    │
│  📊 Confidence: HIGH                                            │
│  🎯 Match Type: text_match                                     │
│  ⚡ Latencia: < 1ms                                            │
└──────────────────┬──────────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
    DETECTADO               NO DETECTADO
        │                     │
        ▼                     ▼
   [RETORNO]         ┌──────────────────────────────┐
   action: "cancel"  │   CAPA 2: PATRONES REGEX    │
   reason: "Option   │                              │
    detected"        │  isDirectConfirmationPattern?│
                     │  isDirectCancellationPattern?│
                     │                              │
                     │  ⚡ Latencia: 0ms           │
                     │  📊 Confidence: HIGH (95%)  │
                     └────────────┬─────────────────┘
                                  │
                        ┌─────────┴─────────┐
                        │                   │
                    DETECTADO           NO DETECTADO
                        │                   │
                        ▼                   ▼
                   [RETORNO]        ┌───────────────────┐
                   action:          │  CAPA 3: NLU      │
                   "confirm"/       │                   │
                   "cancel"         │ Asistente OpenAI │
                                   │                   │
                                   │ ⚠️ Solo si:      │
                                   │ - useNLU: true    │
                                   │ - Keywords        │
                                   │   detectados      │
                                   │                   │
                                   │ Latencia: ~200ms  │
                                   └────────────┬──────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │                       │
                                 DETECTADO            NO DETECTADO
                                    │                       │
                                    ▼                       ▼
                               [RETORNO]          [FLUJO NORMAL]
                               action/              (Detección de
                               intent               paciente, etc.)
```

## Estados de Confianza por Capa

```
┌────────────────────────────────────────────────────────────────────┐
│                     MATRIZ DE CONFIANZA                            │
├────────────────────────────────────────────────────────────────────┤
│ LAYER │ TIPO                 │ EJEMPLO            │ CONFIDENCE      │
├────────────────────────────────────────────────────────────────────┤
│  1    │ Número directo       │ "2"                │ HIGH (100%)    │
│  2    │ Número en letras     │ "dos"              │ HIGH (100%)    │
│  3    │ Ordinal              │ "segundo"          │ HIGH (100%)    │
│  4    │ Posicional           │ "último"           │ HIGH (100%)    │
│  5    │ Text match           │ "cancelar"         │ HIGH (95-100%) │
│  6    │ Fuzzy match          │ "canselr"          │ MEDIUM (65-90%)│
│        │ (Levenshtein)        │                    │                │
│  -    │ No coincidencia      │ "blah blah"        │ LOW (0%)       │
└────────────────────────────────────────────────────────────────────┘
```

## Comparación: Antes vs Después

### ANTES (Sprint 31 y anteriores)

```
Usuario: "quiero cancelar"
    ↓
isDirectCancellationPattern() ?
    ↓
¿Coincide con "/^\.?cancelo\.?$/" ?
    ↓
NO - El regex espera "cancelo" solo, no "quiero cancelar"
    ↓
mightBeCancellation() ?
    ↓
SÍ - Contiene keyword "cancelar"
    ↓
useNLU=true ?
    ↓
Llamar OpenAI Assistant (~200ms)
    ↓
⏱️ COSTO: 200ms + API call + dinero
    ✅ RESULTADO: Detectado (pero lento)
```

### AHORA (Sprint 32)

```
Usuario: "quiero cancelar"
    ↓
detectConfirmationOrCancellationOptionSelection()
    ↓
Busca "cancelar" en:
  - "Sí, cancelar el turno"
  - "No, mantener el turno"
    ↓
✅ ENCONTRADA: "cancelar" en "Sí, cancelar el turno"
    ↓
⏱️ COSTO: < 1ms (string search)
    ✅ RESULTADO: Detectado (muy rápido)
```

## Matriz de Casos de Uso

```
┌──────────────────────────────────────────────────────────────────┐
│         ENTRADA DEL USUARIO → DETECCIÓN → ACCIÓN                 │
├──────────────────────────────────────────────────────────────────┤
│ "2"                     → Opción 2 (index 1)                      │
│ "segundo"               → Opción 2 (index 1)                      │
│ "dos"                   → Opción 2 (index 1)                      │
│ "cambiar"               → Opción 2 "Cambiar/Reagendar"           │
│ "reagendar"             → Opción 2 "Cambiar/Reagendar"           │
│ "modificar"             → Opción 2 (fuzzy match ≈ reagendar)     │
│                                                                   │
│ "1"                     → Opción 1 (index 0)                      │
│ "primero"               → Opción 1 (index 0)                      │
│ "uno"                   → Opción 1 (index 0)                      │
│ "confirmar"             → Opción 1 "Confirmar turno"             │
│ "ok"                    → Opción 1 (fuzzy match ≈ confirmar)     │
│                                                                   │
│ "3"                     → Opción 3 (index 2)                      │
│ "tercero"               → Opción 3 (index 2)                      │
│ "tres"                  → Opción 3 (index 2)                      │
│ "cancelar"              → Opción 3 "Cancelar turno"              │
│ "no voy"                → Opción 3 (fuzzy match ≈ cancelar)      │
│ "quiero cancelar"       → Opción 3 (text match: "cancelar")      │
│                                                                   │
│ "blah blah blah"        → ❌ NO DETECTADO → Pedir aclaración    │
│ ""                      → ❌ VACIO → Pedir aclaración            │
└──────────────────────────────────────────────────────────────────┘
```

## Flujo Completo: De Confirmación/Cancelación

```
┌──────────────────────────────────────────────────────────────────┐
│        USUARIO RESPONDE A RECORDATORIO DE CITA                   │
└──────────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                      │
        ▼                                      ▼
  Usuario escribe:                   Usuario escribe:
  "Confirmo el turno"               "No voy a poder"
        │                                      │
        ▼                                      ▼
┌──────────────────────────┐     ┌──────────────────────────┐
│ CAPA 1: Option Detection │     │ CAPA 1: Option Detection │
│                          │     │                          │
│ ❌ "Confirmo el turno"  │     │ ✅ "No" → Opción 2      │
│    (no es "Sí..." ni     │     │    (text match)          │
│     "No...")            │     │                          │
│                          │     │ Resultado:               │
│ → Continuar CAPA 2      │     │ action: "confirm"       │
└──────────────────────────┘     └──────────────────────────┘
        │                                      │
        ▼                                      ▼
┌──────────────────────────┐           ✅ DETECTADO
│ CAPA 2: Regex Patterns   │           │
│                          │           ▼
│ ✅ isDirectConfirmation  │     [PROCESAR CONFIRMACIÓN]
│    Pattern()             │     Usuario mantiene turno
│                          │
│ Resultado:               │
│ action: "confirm"        │
└──────────────────────────┘
        │
        ▼
   ✅ DETECTADO
   │
   ▼
[PROCESAR CONFIRMACIÓN]
Enviar: "¡Perfecto! Tu turno confirmado"
```

## Monitoreo en Producción

```
📊 MÉTRICAS A TRACKEAR
├─ matchType: distribution
│  ├─ direct_number: X%
│  ├─ word_number: X%
│  ├─ ordinal: X%
│  ├─ positional: X%
│  ├─ text_match: X%    ← Probablemente el más común
│  └─ fuzzy_match: X%
│
├─ confidence: distribution
│  ├─ high: X%
│  ├─ medium: X%
│  └─ low: X%
│
├─ latency:
│  ├─ p50: < 0.5ms
│  ├─ p95: < 2ms
│  └─ p99: < 5ms
│
└─ fallback_to_nlu: X%
   (¿Cuántas veces falla detection y pasa a NLU?)
```

---

**Nota:** Este diagrama representa el flujo mejorado con SPRINT 32. La integración es backward compatible - no afecta flujos existentes.
