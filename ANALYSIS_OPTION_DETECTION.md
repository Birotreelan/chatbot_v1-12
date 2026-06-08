# Análisis: Sistema de Detección de Opciones - Problema y Solución

## 🔴 PROBLEMA IDENTIFICADO

En la conversación analizada, el usuario intenta seleccionar una opción múltiples veces de diferentes formas:

1. **"Solicitar otro turnó y si es de tarde mejor gracias"** - Dice qué quiere pero el sistema no lo entiende
2. **"3 solicitar otro turno médico"** - Número + explicación → No funciona
3. **"Número 3"** - Solo número con palabra → No funciona
4. **"No que número poner quiero cancelar..."** - Dice claramente "cancelar" pero sistema no lo captura

**Logs muestran:**
- Clasificación NLU: `"consulta_con_cortesia"` con confidence 0.9
- El mensaje fue malclasificado en lugar de detectarse como "cancelar_turno"

---

## 🏗️ ARQUITECTURA ACTUAL

### 1. **Capas de Detección Existentes**

```
Sprint 15 (Patient Detection)
    ↓
Sprint 14 (Direct Confirmation/Cancellation) ← ISSUE: No detecta bien en contexto ambiguo
    ↓
Sprint 16 (Reagendamiento NLU)
    ↓
Sprint 17 (?????)
    ↓
Sprint 12 (?????)
    ↓
Sprint 13 (?????)
    ↓
Sprint 18 (NLU Fallback Router) ← Intenta rescatar pero ya es tarde
    ↓
Sprint 9a (Flujo Normal)
```

### 2. **Selection Extractor (Sprint 4)**

**Muy sofisticado para números:**
- Capa 1: Números directos (1, 2, 3)
- Capa 2: Números en letras (uno, dos, tres)
- Capa 3: Ordinales (primero, segundo, tercero)
- Capa 4: Posicionales (último, anterior)
- Capa 5: Text matching con las etiquetas
- Capa 6: Fuzzy matching

**PERO SOLO SE USA PARA:**
- Selección de turnos (`awaiting_turn_selection`)
- Selección de acciones en turnos seleccionados

**NO SE REUTILIZA PARA:**
- Detección de opciones de menú inicial (1- Confirmar, 2- Cancelar, 3- Solicitar otro)
- Detección de opciones cuando el usuario dice "cancelar" en texto libre

### 3. **Direct Confirmation Handler (Sprint 14)**

**Funciona bien con patrones puros:**
```
Regex puro: "cancelo" → Detecta
Regex puro: "no voy" → Detecta
```

**Falla con mensajes naturales:**
```
"No que número poner quiero cancelar el turno de mañana para otro dia"
↓
Contiene keyword "cancelar" → mightBeCancellation() = true
↓
Entra a NLU (classification)
↓
NLU devuelve "consulta_con_cortesia" (malclasificación)
↓
Confidence < 0.70 → No procesa
↓
Message pasa a NLU Fallback Router (Sprint 18)
```

### 4. **NLU Fallback Router (Sprint 18)**

Intenta rescatar pero tiene limitaciones:
- Solo actúa si `appointmentContext` existe
- Solo actúa si mensaje > 5 chars y no es número puro
- Confía demasiado en clasificación de GPT
- El prompt del sistema no es específico para contexto de menú de opciones

---

## 🎯 RAÍZ DEL PROBLEMA

Hay **dos problemas simultáneos:**

1. **Selection Extractor está infrautilizado**
   - Existe un sistema sofisticado para detectar selecciones
   - Pero SOLO se usa para turnos, no para opciones de menú general

2. **NLU de Direct Confirmation es demasiado ambiguo**
   - El asistente `asst_MF6oPGm2Be7Hlb2c40WICsJs` no está bien fine-tuneado
   - El mensaje "No que número poner quiero cancelar..." tiene contexto claro pero es malclasificado

---

## 💡 SOLUCIÓN PROPUESTA: HÍBRIDO CON REUTILIZACIÓN DE CAPAS

### Estrategia: 3 Capas Secuenciales (Sin duplicación)

```
┌─────────────────────────────────────────────────────────────┐
│ CAPA 1: DETECCIÓN DIRECTA (0ms, Regex puro)                │
├─────────────────────────────────────────────────────────────┤
│ Usar: PURO_CONFIRMATION_PATTERNS + PURE_CANCELLATION_PATTERNS
│ Resultado: Si coincide → Procesar directamente
│ Si no coincide → Ir a Capa 2
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CAPA 2: EXTRACCIÓN INTELIGENTE DE OPCIONES (0ms)            │
├─────────────────────────────────────────────────────────────┤
│ Objetivo: Detectar si el usuario eligió opción 1, 2, 3...  │
│                                                               │
│ Usar Selection Extractor con contexto de menú actual:        │
│  - Texto directo: "2" → Opción 2                            │
│  - Texto: "cancelar" → Match "2- Cancelar el turno" → Opción 2
│  - Texto: "segunda opción" → Opción 2                       │
│  - Fuzzy: "reagendar" → Match "3- Solicitar otro" → Opción 3
│                                                               │
│ SelectionOption[] = Opciones actuales del menú              │
│ Resultado: Si coincide → Mapear a acción                    │
│ Si no coincide → Ir a Capa 3
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CAPA 3: NLU CONTEXTUAL (5-7ms, cuando hay ambigüedad)        │
├─────────────────────────────────────────────────────────────┤
│ Usar: NLU del Sistema SOLO como último recurso              │
│ Contexto enriquecido:                                        │
│  - Menciona palabras clave (confirmar, cancelar, etc.)?     │
│  - Qué opciones hay disponibles en este momento?            │
│  - Cuál es el appointmentContext actual?                    │
│                                                               │
│ Resultado: Clasificación con alta confianza                 │
└─────────────────────────────────────────────────────────────┘
```

### Ventajas

1. **Sem ambigüedad:** Cada capa responde si puede, o pasa al siguiente
2. **Reutilización:** Selection Extractor ya existe y funciona bien
3. **Latencia:** Capas 1-2 son casi 0ms (regex)
4. **Contexto:** NLU solo actúa cuando hay verdadera ambigüedad
5. **Debugging:** Fácil saber dónde falla el sistema

---

## 📋 IMPLEMENTACIÓN: Archivos a Crear/Modificar

### 1. **NUEVO: `lib/conversation-state/option-detection-handler.ts`**
   - Reutiliza Selection Extractor
   - Mapea opciones de menú a intentos
   - 3 capas: regex → selection → NLU

### 2. **MODIFICAR: `lib/conversation-state/direct-confirmation-handler.ts`**
   - Integra option-detection-handler
   - Usa para mensaje ambiguo primero

### 3. **MODIFICAR: `lib/whatsapp.tsx`**
   - Detecta menú actual y lo pasa al handler
   - Llama a option-detection-handler antes que otros handlers

### 4. **DOCUMENTACIÓN:**
   - `SPRINT_32_OPTION_DETECTION_HYBRID.md`

---

## 🧪 CASOS DE PRUEBA

```
Contexto Menú:
1- Confirmar asistencia
2- Cancelar turno
3- Solicitar otro turno

┌──────────────────────────────────────────────────────────┐
│ Entrada User        │ Capa   │ Resultado                │
├──────────────────────────────────────────────────────────┤
│ "2"                 │ 1/2    │ ✅ Opción 2 (cancelar)  │
│ "opción 2"          │ 2      │ ✅ Opción 2              │
│ "cancelar"          │ 1      │ ✅ Opción 2 (regex)      │
│ "no voy"            │ 1      │ ✅ Opción 2 (regex)      │
│ "quiero reagendar"  │ 2      │ ✅ Opción 3 (fuzzy)      │
│ "segunda opción"    │ 2      │ ✅ Opción 2              │
│ "la tercera"        │ 2      │ ✅ Opción 3              │
│ "no que numero..."  │ 2→3    │ ✅ Opción 2 (NLU)        │
│ "hola cómo estás"   │ 3      │ ❌ No es opción (NLU)   │
└──────────────────────────────────────────────────────────┘
```

