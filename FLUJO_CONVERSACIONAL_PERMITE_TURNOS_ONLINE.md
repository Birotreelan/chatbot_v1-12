# Flujo Conversacional - Validación Permite_Turnos_Online

## 1️⃣ PACIENTE NUEVO - UNA OBRA SOCIAL ENCONTRADA

### Escenario A: Obra Social PERMITE Turnos Online

```
┌─────────────────────────────────┐
│ Usuario: "PAMI"                 │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris valida en get_obras_sociales│
│ API devuelve:                    │
│ - nombre: "PAMI"                 │
│ - permite_turnos_online: TRUE ✅  │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris: "Gracias María.            │
│ Tu cobertura es PAMI.            │
│                                  │
│ Para continuar, selecciona la   │
│ sede donde querés atenderte:     │
│                                  │
│ 1. Clínica De Ojos               │
│    Ubicación: Mansilla 296...    │
│                                  │
│ Responde con el número de la    │
│ sede que prefieras."             │
│                                  │
│ FLUJO CONTINÚA ✅               │
└─────────────────────────────────┘
          ↓
    [Selección de Sede]
```

---

### Escenario B: Obra Social NO PERMITE Turnos Online

```
┌─────────────────────────────────┐
│ Usuario: "PAMI"                 │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris valida en get_obras_sociales│
│ API devuelve:                    │
│ - nombre: "PAMI"                 │
│ - permite_turnos_online: FALSE ❌ │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ ⚠️ VALIDACIÓN FALLIDA            │
│                                  │
│ Iris: "Gracias María.            │
│ Lamentablemente, PAMI no está   │
│ habilitada para agendar turnos  │
│ por este medio.                  │
│                                  │
│ Para agendar tu turno,           │
│ por favor contactanos al:        │
│ *+54 9 123 4567890*             │
│                                  │
│ FLUJO TERMINA ❌                │
└─────────────────────────────────┘
    [Derivación a Teléfono]
```

---

## 2️⃣ PACIENTE NUEVO - MÚLTIPLES OBRAS SOCIALES

### Escenario A: Selecciona Obra Social CON Permisos

```
┌─────────────────────────────────┐
│ Usuario: "Swiss"                │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris obtiene múltiples opciones:│
│ - Swiss Medical                  │
│ - Swiss Medical Plus             │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris: "Encontre varias opciones │
│ para 'Swiss':                    │
│                                  │
│ 1. Swiss Medical                 │
│ 2. Swiss Medical Plus            │
│                                  │
│ Responde con el número de tu    │
│ obra social."                    │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Usuario: "1"                    │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris valida opción seleccionada:│
│ - nombre: "Swiss Medical"        │
│ - permite_turnos_online: TRUE ✅  │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris: "Gracias María.            │
│ Tu cobertura es Swiss Medical.  │
│                                  │
│ Para continuar, selecciona la   │
│ sede donde querés atenderte..."  │
│                                  │
│ FLUJO CONTINÚA ✅               │
└─────────────────────────────────┘
```

---

### Escenario B: Selecciona Obra Social SIN Permisos

```
┌─────────────────────────────────┐
│ Usuario: "Swiss"                │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris obtiene múltiples opciones │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris: "Encontre varias opciones │
│ para 'Swiss':                    │
│                                  │
│ 1. Swiss Medical                 │
│ 2. Swiss Medical Plus            │
│                                  │
│ Responde con el número..."       │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Usuario: "1"                    │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris valida opción seleccionada:│
│ - nombre: "Swiss Medical"        │
│ - permite_turnos_online: FALSE ❌ │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ ⚠️ VALIDACIÓN FALLIDA            │
│                                  │
│ Iris: "Gracias María.            │
│ Lamentablemente, Swiss Medical  │
│ no está habilitada para agendar │
│ turnos por este medio.           │
│                                  │
│ Para agendar tu turno,           │
│ por favor contactanos al:        │
│ *+54 9 123 4567890*             │
│                                  │
│ FLUJO TERMINA ❌                │
└─────────────────────────────────┘
```

---

## 3️⃣ PACIENTE EXISTENTE

### Escenario A: Obra Social PERMITE Turnos Online

```
┌─────────────────────────────────┐
│ Sistema detecta paciente        │
│ existente (vía DNI o teléfono)  │
│                                  │
│ Datos en API:                    │
│ - nombre: "Juan Pérez"           │
│ - obra_social: "PAMI"            │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris valida obra social en      │
│ initializeExistingPatientFlow    │
│                                  │
│ API devuelve:                    │
│ - permite_turnos_online: TRUE ✅  │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris: "Hola Juan, te ayudo a    │
│ agendar un nuevo turno.          │
│                                  │
│ Para continuar, selecciona la   │
│ sede donde querés atenderte:     │
│                                  │
│ 1. Clínica De Ojos...            │
│                                  │
│ FLUJO CONTINÚA ✅               │
└─────────────────────────────────┘
          ↓
    [Selección de Sede]
```

---

### Escenario B: Obra Social NO PERMITE Turnos Online

```
┌─────────────────────────────────┐
│ Sistema detecta paciente        │
│ existente                        │
│                                  │
│ Datos en API:                    │
│ - nombre: "Juan Pérez"           │
│ - obra_social: "PAMI"            │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Iris valida obra social en      │
│ initializeExistingPatientFlow    │
│                                  │
│ API devuelve:                    │
│ - permite_turnos_online: FALSE ❌ │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ ⚠️ VALIDACIÓN FALLIDA            │
│                                  │
│ Iris: "Hola Juan.               │
│ Lamentablemente, tu obra social │
│ (PAMI) no está habilitada para  │
│ agendar turnos por este medio.  │
│                                  │
│ Para agendar tu turno,           │
│ por favor contactanos al:        │
│ *+54 9 123 4567890*             │
│                                  │
│ FLUJO TERMINA ❌                │
│ (NO muestra sedes)              │
└─────────────────────────────────┘
    [Derivación a Teléfono]
```

---

## 📋 Matriz de Decisión

| Escenario | Tipo | Busca | Encuentra | `permite_turnos_online` | Resultado |
|-----------|------|-------|-----------|------------------------|-----------|
| 1 | Nuevo | "PAMI" | 1 obra | `true` | ✅ Continúa a sedes |
| 2 | Nuevo | "PAMI" | 1 obra | `false` | ❌ Derivación inmediata |
| 3 | Nuevo | "Swiss" | 2 obras | Selecciona `true` | ✅ Continúa a sedes |
| 4 | Nuevo | "Swiss" | 2 obras | Selecciona `false` | ❌ Derivación en selección |
| 5 | Existente | (DNI) | Detecta | `true` | ✅ Continúa a sedes |
| 6 | Existente | (DNI) | Detecta | `false` | ❌ Derivación al iniciar |

---

## 🔍 Puntos de Validación

### Paciente Nuevo
1. **`handleObraSocialPhase`** - Cuando encuentra 1 obra social
2. **`handleObraSocialSelectionPhase`** - Cuando user selecciona de múltiples

### Paciente Existente
1. **`initializeExistingPatientFlow`** - Al inicializar flujo (antes de mostrar sedes)

---

## 📞 Configuración de Derivación

**Variable de Entorno:** `ESCALATION_PHONE_NUMBER`

```
Ejemplo: +54 9 11 6123 4567

Si no está configurada → Muestra: "[NÚMERO DE DERIVACIÓN]"
```

---

## 🚨 Comportamiento en Errores

| Escenario | Acción |
|-----------|--------|
| API de obras sociales falla | Fallback permisivo (asume `true`, continúa) |
| `ESCALATION_PHONE_NUMBER` no configurada | Muestra placeholder, no bloquea |
| `permite_turnos_online === null/undefined` | Trata como `true`, permite continuar |
