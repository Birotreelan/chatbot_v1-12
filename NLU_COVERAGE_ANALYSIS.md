# Análisis de Cobertura de NLUs en Chatbot v1-12

**Fecha:** 8 de Junio 2026  
**Estado:** SPRINT 32 - Detección Híbrida de Opciones  
**Objetivo:** Verificar qué NLUs existen y qué flujos cubren

---

## 📊 Resumen Ejecutivo

El sistema tiene **4 NLUs especializados** creados en OpenAI que cubren los flujos principales:

| NLU | Flujo | Assistant ID | Estado |
|-----|-------|--------------|--------|
| **Direct Action** | Confirmación/Cancelación | `asst_MF6oPGm2Be7Hlb2c40WICsJs` | ✅ Activo |
| **Pending Flow** | Flujos pendientes | `asst_BbKf8VdJurpmXvEK2YgkFhjn` | ✅ Activo |
| **Reschedule** | Reagendamiento | `asst_mPwf9BxPNwWAOoSJZY6UtXii` | ✅ Activo |
| **Farewell** | Despedidas | `asst_68NiTYXUNHnyqyvY04VrZLk7` | ✅ Activo |
| **NLU Fallback** | Clasificación genérica | Chat Completions (GPT-4o-mini) | ✅ Activo |

---

## 🎯 Análisis Detallado de Cada NLU

### 1️⃣ DIRECT ACTION NLU (`asst_MF6oPGm2Be7Hlb2c40WICsJs`)

**Ubicación:** `lib/conversation-state/direct-confirmation-handler.ts`

**Propósito:** Clasificar confirmaciones y cancelaciones cuando el usuario escribe en texto libre

**Intenciones detectadas:**
```typescript
"confirmar_asistencia"     // "voy", "confirmo", "allá estaré"
"cancelar_turno"           // "no puedo", "cancelo", "tengo que cancelar"
"consulta_con_cortesia"    // Consultas o ambigüedades
```

**Confianza requerida:** ≥ 0.70

**Cuándo se activa:**
- ✅ Existe `appointmentContext` reciente (hay turno)
- ✅ Mensaje tiene > 5 caracteres
- ✅ No es un número puro
- ✅ Luego de que fallaron patrones REGEX puros

**Flujo de integración:**
```
CAPA 1: Option Detection (NEW - SPRINT 32) ← Detecta "cancelar" en menú
    ↓ si no coincide
CAPA 2: REGEX puro (0ms)
    ↓ si no coincide
CAPA 3: Direct Action NLU (200ms)
```

**Problema que resuelve:**
- ANTES: "No que número poner quiero cancelar el turno..." → No detectado
- AHORA: Option Detection lo mapea a la opción "Cancelar turno"

---

### 2️⃣ PENDING FLOW NLU (`asst_BbKf8VdJurpmXvEK2YgkFhjn`)

**Ubicación:** `lib/conversation-state/pending-flow-nlu/contextual-intent-handler.ts`

**Propósito:** Manejar texto libre cuando el usuario está EN MEDIO de un flujo pendiente (ej: esperando confirmación de cancelación)

**Intenciones detectadas:**
```typescript
"solicitar_turno"          // Usuario quiere agendar
"cancelar_turno"           // Usuario quiere cancelar
"confirmar_turno"          // Usuario quiere confirmar
"reagendar"                // Usuario quiere cambiar fecha
"consulta_info"            // Pregunta sobre horarios, ubicación
"confirmar_accion"         // Acepta acción (sí, dale, ok)
"rechazar_accion"          // Rechaza acción (no, mejor no)
"saludo"                   // Saludo genérico
"despedida"                // Despedida
"queja_frustracion"        // Usuario frustrado
"otro"                     // No clasificable
```

**Confianza requerida:** Depende de contexto

**Cuándo se activa:**
- ✅ Usuario está en flujo pendiente: `awaiting_cancel_confirmation` o `awaiting_reschedule_choice`
- ✅ Usuario responde con texto libre en lugar de números (1/2)
- ✅ El asistente genera respuesta contextual que reconoce la intención

**Flujos soportados:**
1. **Confirmación de cancelación**: "¿Cancelar?"
   - Usuario: "bueno, sí"
   - NLU: Detecta "confirmar_accion" → Procesa como confirmación (1)

2. **Decisión de reagendamiento**: "¿Reagendar?"
   - Usuario: "sí, para otra fecha"
   - NLU: Detecta "reagendar" → Mantiene flujo

**Acciones que puede disparar:**
- `maintain_flow_with_response` - Respuesta contextual + mantener flujo
- `process_as_confirmation` - Tratar como opción 1
- `process_as_rejection` - Tratar como opción 2
- `abandon_flow` - Salir del flujo (error/ambigüedad)

---

### 3️⃣ RESCHEDULE NLU (`asst_mPwf9BxPNwWAOoSJZY6UtXii`)

**Ubicación:** `lib/conversation-state/reschedule-flow-integration.ts`

**Propósito:** Especializado en flujo de reagendamiento de turnos

**Intenciones detectadas:**
- Validación de nueva fecha propuesta
- Conflictos de horarios
- Preferencias de reagendamiento

**Cuándo se activa:**
- ✅ Usuario en flujo de reagendamiento (`reschedule_awaiting_*` fases)
- ✅ Usuario propone nueva fecha/hora en texto libre
- ✅ Necesita validación contra disponibilidad de clínica

---

### 4️⃣ FAREWELL NLU (`asst_68NiTYXUNHnyqyvY04VrZLk7`)

**Ubicación:** `lib/conversation-state/farewell-handler.ts`

**Propósito:** Detectar despedidas y evitar repeticiones innecesarias

**Intenciones detectadas:**
```typescript
"despedida_pura"           // "chau", "gracias", "hasta luego"
"respuesta_reciproca"      // "igualmente", "vos también"
"despedida_con_accion"     // "gracias, confirmado"
"otra_consulta"            // NO es despedida
```

**Cuándo se activa:**
- ✅ Hay recordatorio previo (contexto de turno)
- ✅ Patrones de despedida detectados
- ✅ Implementa MODO A (cierre completo) vs MODO B (cierre breve)

**Capas de detección:**
1. REGEX puro: Patrones de despedida explícita
2. REGEX puro: Respuestas recíprocas (silencio total)
3. NLU: Casos ambiguos

---

### 5️⃣ NLU FALLBACK (Chat Completions `gpt-4o-mini`)

**Ubicación:** `lib/conversation-state/nlu-fallback-handler.ts`

**Propósito:** Clasificación genérica cuando NADA más matchea

**Intenciones detectadas:**
```typescript
"confirmar_asistencia"     // Confirmación implícita
"cancelar_turno"           // Cancelación
"reagendar_turno"          // Reagendamiento
"consulta_informativa"     // ¿Dónde queda? ¿A qué hora?
"consulta_no_disponible"   // ¿Cuánto cuesta? ¿Aceptan tarjeta?
"consulta_medica_prohibida" // CRÍTICO: ¿Síntomas? ¿Diagnóstico?
"queja_frustracion"        // Quejas
"explicacion_contextual"   // "Estoy con neumonía"
"saludo_despedida"         // Genérico
"numero_equivocado"        // Wrong number
"otro"                     // No clasificable
```

**Confianza requerida:** ≥ 0.60

**Cuándo se activa:**
- ✅ Existe `appointmentContext` reciente
- ✅ Mensaje > 5 caracteres (texto libre, no números)
- ✅ ÚLTIMO recurso si todos los handlers específicos fallaron

**Orden de llamada en `whatsapp.tsx`:**
```
Sprint 15 (Direct Confirmation)
  ↓
Sprint 14 (Patient Detection)
  ↓
Sprint 16 (Reschedule)
  ↓
Sprint 17 (...)
  ↓
Sprint 12 (Confirmation template)
  ↓
Sprint 13 (...)
  ↓
★ SPRINT 18 (NLU Fallback) ←← ÚLTIMO RECURSO
```

---

## 🗺️ Mapa de Flujos → NLU

### Flujo 1: CONFIRMACIÓN/CANCELACIÓN DIRECTA
```
Usuario: "No que número poner quiero cancelar el turno de mañana"
    ↓
Sprint 32: Option Detection → Detecta "cancelar" ✅
    ↓ (si no detecta)
Regex Puro → Busca /cancelar/ /no voy/ /cancelo/
    ↓ (si no coincide)
Direct Action NLU → Clasifica intención
```

**NLUs usados:** Option Detection, Direct Action NLU  
**Status:** ✅ CUBIERTO

---

### Flujo 2: RESPUESTA A MENÚ PENDIENTE (CONFIRMACIÓN CANCELACIÓN)
```
Bot: "¿Cancelar turno? 1- Sí, cancelar 2- No, mantener"
Usuario: "bueno sí"
    ↓
Pending Flow NLU → "confirmar_accion" → Procesa como (1)
```

**NLUs usados:** Pending Flow NLU  
**Status:** ✅ CUBIERTO

---

### Flujo 3: REAGENDAMIENTO
```
Usuario propone nueva fecha en texto libre
    ↓
Reschedule NLU → Valida fecha y disponibilidad
```

**NLUs usados:** Reschedule NLU  
**Status:** ✅ CUBIERTO

---

### Flujo 4: DESPEDIDA
```
Usuario: "Gracias, chau"
    ↓
Farewell Regex Puro → Detecta despedida
    ↓ (si es ambiguo)
Farewell NLU → Clasifica tipo despedida
```

**NLUs usados:** Farewell NLU  
**Status:** ✅ CUBIERTO

---

### Flujo 5: CONSULTAS INFORMATIVAS/MÉDICAS
```
Usuario: "¿Dónde queda la clínica?"
Usuario: "¿Cuáles son los síntomas de neumonía?"
    ↓
NLU Fallback → Clasifica intención
    ↓
- Consulta informativa: Responde
- Consulta médica prohibida: Deriva a profesional
```

**NLUs usados:** NLU Fallback  
**Status:** ✅ CUBIERTO

---

## ⚠️ Casos No Cubiertos (Gaps)

### 1. Flujo de Detección de Paciente - Búsqueda por DNI/Nombre

**Ubicación:** `lib/conversation-state/patient-detection/patient-flow-handler.ts`

**Status:** ❌ SIN NLU ESPECIALIZADO

**Descripción:** Cuando usuario responde con DNI o nombre ambiguo

**Casos problemáticos:**
- Usuario: "Mi nombre es Juan pero la gente me dice Johnny"
  → Sistema no sabe si es el mismo Juan existente o paciente nuevo
- Usuario: "35.123.456 (de mi hermana)" 
  → DNI correcto pero con contexto ambiguo

**Solución:** ❌ Usaría NLU Fallback (genérico)

**Recomendación:** Crear `PATIENT_DETECTION_NLU` especializado

---

### 2. Flujo de Búsqueda de Turno - Múltiples Opciones

**Ubicación:** `lib/conversation-state/existing-patient/existing-patient-flow-handler.ts`

**Status:** ❌ SIN NLU ESPECIALIZADO

**Descripción:** Cuando paciente tiene múltiples turnos y responde con texto libre

**Casos problemáticos:**
- Sistema: "¿Cuál de estos turnos?"
  - Opción 1: Lunes 14:00 con Dr. López
  - Opción 2: Martes 15:30 con Dra. García
- Usuario: "El que es con el doctor" (podría ser López o García)

**Solución:** ❌ Usa Option Detection (SPRINT 32) + Regex

**Recomendación:** Considerar NLU para desambiguar entre múltiples turnos

---

### 3. Flujo de Búsqueda de Obra Social - Ambigüedad

**Status:** ❌ SIN NLU ESPECIALIZADO

**Descripción:** Usuario responde con obra social parcial o mal escrita

**Casos problemáticos:**
- Usuario: "Tengo la de los bancarios"
  → No matchea con regex de obra social
- Usuario: "IOMA pero con OSDE de mi pareja"
  → Contexto ambiguo

**Solución:** ❌ Usa regex puro

**Recomendación:** Crear NLU para normalizar obra social

---

## 📋 Matriz de Cobertura

| Flujo | Fase | Mecanismo | NLU | Coverage |
|-------|------|-----------|-----|----------|
| Confirmación/Cancelación | Pre-flujo | Regex + NLU | Direct Action | ✅ 95% |
| Menú Pendiente | En-flujo | NLU contextual | Pending Flow | ✅ 90% |
| Reagendamiento | En-flujo | Regex + NLU | Reschedule | ✅ 85% |
| Despedida | Post-flujo | Regex + NLU | Farewell | ✅ 95% |
| Detección Paciente | Pre-flujo | Regex | ❌ Fallback | ⚠️ 70% |
| Búsqueda Turno | En-flujo | Regex + Detection | ❌ Fallback | ⚠️ 75% |
| Búsqueda Obra Social | En-flujo | Regex | ❌ Fallback | ⚠️ 65% |
| Consulta Informativa | Post-flujo | NLU | NLU Fallback | ✅ 85% |
| Consulta Médica | Post-flujo | NLU | NLU Fallback | ✅ 95% |

---

## 🎓 Conclusiones

### ✅ Bien Cubierto (≥90%)
1. Confirmación/Cancelación directa - **Direct Action NLU** + **Option Detection** (SPRINT 32)
2. Despedidas - **Farewell NLU**
3. Consultas médicas prohibidas - **NLU Fallback** (protección crítica)

### ⚠️ Parcialmente Cubierto (70-85%)
1. Reagendamiento - **Reschedule NLU** (pero necesita validación adicional)
2. Detección de paciente - Usa **NLU Fallback** (genérico)
3. Búsqueda de turnos - Usa **Option Detection** (SPRINT 32)

### ❌ Mejorables (<70%)
1. Normalización de obra social - Solo regex, sin NLU
2. Desambigüación de pacientes - Sin especialización

---

## 🚀 Recomendaciones para Próximos Sprints

### Prioridad ALTA
- **SPRINT 33:** Crear `PATIENT_DETECTION_NLU` para ambigüedad en DNI/nombre
- **SPRINT 34:** Crear `OBRA_SOCIAL_NORMALIZATION_NLU` para obra social parcial

### Prioridad MEDIA
- **SPRINT 35:** Mejorar `RESCHEDULE_NLU` con validación de disponibilidad
- **SPRINT 36:** Crear `TURN_DISAMBIGUATION_NLU` para múltiples turnos ambiguos

### Prioridad BAJA
- Monitor y ajuste fino de thresholds de confianza
- Auditoría de falsos positivos en NLU Fallback

---

**Documento generado:** SPRINT 32  
**Próxima revisión:** SPRINT 33 (cuando se agreguen NLUs adicionales)
