# DIAGRAMAS VISUALES: SISTEMA ACTUAL vs. PROPUESTO

## 1. ARQUITECTURA ACTUAL (TODAY)

### Flujo Simple (Hoy)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLIENTE EXTERNO                                │
│         (Sistema de turnos, software médico, etc.)                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ PROBLEMA: 
                           │ Cliente arma el mensaje 
                           │ manualmente
                           ↓
                    ┌──────────────┐
                    │  Body texto  │
                    │   completo   │
                    └──────┬───────┘
                           │
                   POST /api/send-template
                           │
                           ↓
        ┌────────────────────────────────────────┐
        │    Nuestro Servidor                    │
        ├────────────────────────────────────────┤
        │ 1. Valida Cliente_Id                   │
        │ 2. Valida Body (no vacío)              │
        │ 3. Busca WhatsApp config               │
        │ 4. Normaliza teléfono                  │
        │ 5. Envía Body EXACTO a WhatsApp API   │
        │ 6. Guarda en Redis                     │
        │ 7. Notifica OpenAI (si hay thread)     │
        └────────────────┬───────────────────────┘
                         │
                         ↓
        ┌────────────────────────────────────────┐
        │     WhatsApp API (Meta)                │
        │   Reenvia exactamente el Body          │
        └────────────────┬───────────────────────┘
                         │
                         ↓
        ┌────────────────────────────────────────┐
        │            USUARIO                     │
        │                                        │
        │  "Hola Juan, recordamos tu turno      │
        │   mañana a 15:00 con Dr. López        │
        │   Confirma: 1                          │
        │   Cancela: 2"                          │
        │                                        │
        │  ⚠️ Mensaje tal como lo envió cliente  │
        └────────────────────────────────────────┘
```

### Problema: Inconsistencia

```
Cliente A envía:        Cliente B envía:        Cliente C envía:
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ "Hola {{nombre}} │   │ "Hi {{name}},    │   │ "Estimado/a      │
│ recordamos       │   │ reminder for     │   │ {{nombre}},      │
│ turno {{fecha}}  │   │ {{date}} at      │   │ le recordamos... │
│ a {{hora}}"      │   │ {{time}}"        │   │                  │
└──────────────────┘   └──────────────────┘   └──────────────────┘

❌ Sin consistencia
❌ Sin estándares
❌ Imposible centralizar cambios
```

---

## 2. ARQUITECTURA PROPUESTA (NUEVO)

### Flujo con Templates Gestionados

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLIENTE EXTERNO                                │
│         (Sistema de turnos, software médico, etc.)                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ MEJORA: 
                           │ Cliente solo proporciona
                           │ Template_Id + variables
                           ↓
        ┌──────────────────────────────────────┐
        │ {                                    │
        │   "Template_Id": "tpl_reminder",     │
        │   "TemplateVariables": {             │
        │     "nombre": "Juan",                │
        │     "fecha": "mañana",               │
        │     "hora": "15:00",                 │
        │     "profesional": "Dr. López"       │
        │   }                                  │
        │ }                                    │
        └──────┬───────────────────────────────┘
               │
       POST /api/send-template (V2)
               │
               ↓
    ┌─────────────────────────────────────────────────┐
    │    NUESTRO SERVIDOR                             │
    ├─────────────────────────────────────────────────┤
    │ 1. Valida Cliente_Id                            │
    │ 2. Obtiene Template de DB                       │
    │ 3. ✅ PERSONALIZA: reemplaza {{variables}}      │
    │    "Hola {{nombre}}, recordamos tu turno        │
    │     {{fecha}} a {{hora}} con {{profesional}}"   │
    │         ↓                                        │
    │    "Hola Juan, recordamos tu turno              │
    │     mañana a 15:00 con Dr. López"               │
    │ 4. Valida variables requeridas                  │
    │ 5. Envía Body personalizado a WhatsApp          │
    │ 6. Guarda en Redis (con template_id)            │
    │ 7. Registra métrica (tpl_reminder:sent)         │
    └─────────┬──────────────────────────────────────┘
              │
              ↓
    ┌─────────────────────────────────────────────────┐
    │     WhatsApp API (Meta)                         │
    │   Reenvia Body PERSONALIZADO                    │
    └─────────┬──────────────────────────────────────┘
              │
              ↓
    ┌─────────────────────────────────────────────────┐
    │            USUARIO                              │
    │                                                 │
    │  "Hola Juan, recordamos tu turno               │
    │   mañana a 15:00 con Dr. López                 │
    │   Confirma: 1                                   │
    │   Cancela: 2"                                   │
    │                                                 │
    │  ✅ Mensaje estandarizado, personalizado         │
    └─────────────────────────────────────────────────┘
```

### Ventaja: Consistencia Central

```
MISMO TEMPLATE para todos:

┌──────────────────────────────┐
│ tpl_reminder (nuestra BD)    │
├──────────────────────────────┤
│ "Hola {{nombre}},            │
│  recordamos tu turno         │
│  {{fecha}} a {{hora}}        │
│  con {{profesional}}"        │
└──────────────────────────────┘
        ↑
    ┌───┴────┬────────┬────────┐
    │        │        │        │
┌───────┐┌───────┐┌───────┐┌───────┐
│Client │ Client │ Client │ Client │
│  A    │  B    │  C    │  D    │
└───────┘└───────┘└───────┘└───────┘

✅ Mismo template para todos
✅ Cambio centralizado
✅ Control de calidad
```

---

## 3. FLUJO CON CONFIRMACIÓN (RESPUESTA DEL USUARIO)

### Flujo Completo (Recordatorio + Confirmación)

```
TIMESTEP 1: Enviamos Recordatorio
─────────────────────────────────────

    Cliente Externa
         ↓
    POST /api/send-template {
      Template_Id: "tpl_reminder",
      TemplateVariables: { nombre, fecha, hora, profesional }
    }
         ↓
    Personalización: "Hola Juan, mañana a 15:00 con Dr. López"
         ↓
    WhatsApp API
         ↓
    USUARIO recibe recordatorio
         │
         └─ Redis: evento "reminder_sent"


TIMESTEP 2: Usuario Responde
─────────────────────────────────────

    Usuario: "1" (confirma)
         ↓
    Webhook de Meta
         ↓
    /webhook (processa respuesta)
         ↓
    reminder-mode-handler.ts:
    ├─ Detecta intención: "CONFIRMACION"
    ├─ Obtiene template: "tpl_confirmation"
    ├─ Personaliza: "¡Perfecto Juan! Confirmamos tu turno"
    └─ Envía respuesta
         ↓
    USUARIO recibe confirmación
         │
         └─ Redis: evento "reminder_confirmed"
         └─ DB: log_appointment_confirmed
```

### Diagrama de Estados

```
                 USUARIO RECIBE RECORDATORIO
                            ↓
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ↓                  ↓                  ↓
      Confirma           Cancela            Ignora
      ("1", "sí")        ("2", "no")      (sin respuesta)
         │                  │                  │
         ↓                  ↓                  ↓
    Respuesta:        Respuesta:          (timeout 24h)
    "Confirmado"      "Cancelado"
                                             │
                                             ↓
    ✅                  ✅              Estado: "No contactado"
    appointment       appointment        (métrica especial)
    _confirmed        _cancelled
```

---

## 4. FLUJO DE DERIVACIÓN (NUEVO en REMINDERS_ONLY mode)

### Detectar Intención y Derivar

```
Usuario dice: "necesito cambiar el turno"
             ↓
    Detecta: DERIVACION
             ↓
    Obtiene template: "tpl_derivation"
             ↓
    Construcción de mensaje con canales:

    "¿Necesitas cambiar?
     📞 Teléfono: +54-11-XXXX-XXXX
     📧 Email: agenda@clinica.com.ar
     🌐 Web: www.clinica.com/agendar
     💬 WhatsApp: +54-9-11-XXXX"

             ↓
    USUARIO ve opciones de contacto
             ↓
    Usuario elige canal
```

---

## 5. ARQUITECTURA DE DATOS - TABLAS/REDIS

### Antes (Actual)

```
┌─────────────────────────────────────┐
│         Redis / Memory              │
├─────────────────────────────────────┤
│                                     │
│  thread:{phone}:{config_id}         │
│  → ThreadInfo (OpenAI)              │
│                                     │
│  conversation:{phone}:{config_id}   │
│  → [Mensaje 1, Mensaje 2, ...]      │
│                                     │
│  conversation_state:{phone}         │
│  → {phase, data, ...}               │
│                                     │
│  whatsapp_config:{config_id}        │
│  → WhatsAppConfig                   │
│                                     │
│  global_template:{id}               │
│  → GlobalTemplate (SOLO LECTURA)    │
│                                     │
│  ⚠️ NO HAY: Templates por cliente    │
│                                     │
└─────────────────────────────────────┘
```

### Después (Propuesto)

```
┌──────────────────────────────────────────┐
│         Redis / Memory                   │
├──────────────────────────────────────────┤
│                                          │
│  thread:{phone}:{config_id}              │
│  → ThreadInfo (OpenAI)                   │
│                                          │
│  conversation:{phone}:{config_id}        │
│  → [Mensaje 1, Mensaje 2, ...]           │
│                                          │
│  conversation_state:{phone}              │
│  → {phase, data, reminder_mode...}       │
│                                          │
│  whatsapp_config:{config_id}             │
│  → WhatsAppConfig + reminder_mode_config │
│                                          │
│  global_template:{id}                    │
│  → GlobalTemplate (SOLO LECTURA)         │
│                                          │
│  ✅ NUEVO: client_reminder_template:{id} │
│  → ClientReminderTemplate                │
│     {                                    │
│       cliente_id, type, body,            │
│       variables, active                  │
│     }                                    │
│                                          │
│  ✅ NUEVO: appointment_event:{client_id} │
│  → [                                     │
│      {type: "reminder_sent", time},      │
│      {type: "reminder_confirmed", time}, │
│      {type: "reminder_cancelled", time}  │
│    ]                                     │
│                                          │
└──────────────────────────────────────────┘
```

---

## 6. FLUJO DE CONTROL EN ROUTER (`/lib/whatsapp.tsx`)

### Lógica de Enrutamiento

```
┌─────────────────────────────────────────────────┐
│   Webhook de Meta (usuario responde)            │
│   {phone, message}                              │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
        ┌────────────────────────────┐
        │ Obtener WhatsApp Config    │
        │ Obtener Client Mode        │
        └────────┬───────────────────┘
                 │
                 ↓
        ┌────────────────────────────┐
        │ ¿Modo del cliente?         │
        └────┬────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ↓                 ↓
  REMINDERS_ONLY   CHATBOT_FULL
    │                 │
    ↓                 ↓
reminder-mode-   patient-detection/
handler.ts       existing-patient/
                 new-patient/
    │                 │
    ↓                 ↓
Detecta:          Detecta:
- confirmación    - confirmación/anulación
- cancelación       automática (si habilitado)
- despedida       - intención de paciente
- derivación      - DNI / búsqueda
- otra consulta   - turnos disponibles
                  - reagendamiento
    │                 │
    ↓                 ↓
Responde con      Responde con
template:         respuesta OpenAI
- confirmación    (thread)
- cancelación
- derivación
- silencia si
  despedida

    │                 │
    ↓                 ↓
Actualiza        Actualiza
estado:          estado:
reminder_confirmed chatbot_confirmed
reminder_cancelled (o cancellado)
(o ignorado)
```

---

## 7. CADENA DE PERSONALIZACIÓN

### Motor de Reemplazo de Variables

```
Template Original:
┌─────────────────────────────────────────┐
│ "Hola {{nombre}},                       │
│  recordamos tu turno                    │
│  {{fecha}} a {{hora}}                   │
│  con {{profesional}}                    │
│  en {{lugar}}"                          │
└─────────────────────────────────────────┘

Variables Proporcionadas:
┌─────────────────────────────────────────┐
│ {                                       │
│   nombre: "Juan López",                 │
│   fecha: "mañana 15 de junio",          │
│   hora: "15:30",                        │
│   profesional: "Dr. Carlos García",     │
│   lugar: "Consultorio 2 - Piso 3"       │
│ }                                       │
└─────────────────────────────────────────┘

Motor de Personalización:
┌─────────────────────────────────────────┐
│ 1. Detectar todas {{variables}}         │
│ 2. Por cada variable:                   │
│    {{nombre}} → "Juan López"            │
│    {{fecha}} → "mañana 15 de junio"     │
│    {{hora}} → "15:30"                   │
│    {{profesional}} → "Dr. García"       │
│    {{lugar}} → "Consultorio 2"          │
│ 3. Validar que existan todas            │
│ 4. Reemplazar                           │
└─────────────────────────────────────────┘

Resultado Final:
┌─────────────────────────────────────────┐
│ "Hola Juan López,                       │
│  recordamos tu turno                    │
│  mañana 15 de junio a 15:30             │
│  con Dr. Carlos García                  │
│  en Consultorio 2 - Piso 3"             │
└─────────────────────────────────────────┘

✅ Enviado al usuario
```

---

## 8. MIGRACIÓN GRADUAL (Fallback)

### Timeline de Migración

```
DÍA 1: Código Nuevo Desplegado
┌────────────────────────────────────┐
│ TODOS en LEGACY mode (default)     │
│ Código nuevo: INACTIVO             │
│ Fallback: Automático               │
├────────────────────────────────────┤
│ Cliente A: LEGACY (Body tal como)  │
│ Cliente B: LEGACY (Body tal como)  │
│ Cliente C: LEGACY (Body tal como)  │
└────────────────────────────────────┘


DÍA 15: Migración Piloto
┌────────────────────────────────────┐
│ ALGUNOS en MANAGED mode            │
├────────────────────────────────────┤
│ Cliente A: LEGACY (Body tal como)  │
│ Cliente B: ✅ MANAGED (templates)  │
│ Cliente C: LEGACY (Body tal como)  │
└────────────────────────────────────┘


MES 1: Migración Completa
┌────────────────────────────────────┐
│ TODOS en MANAGED mode              │
├────────────────────────────────────┤
│ Cliente A: ✅ MANAGED (templates)  │
│ Cliente B: ✅ MANAGED (templates)  │
│ Cliente C: ✅ MANAGED (templates)  │
└────────────────────────────────────┘


LEGACY FALLBACK (Siempre disponible):
┌────────────────────────────────────┐
│ Si algo falla en MANAGED:          │
│                                    │
│ if (!template || error) {          │
│   use Body tal como viene          │
│   (LEGACY mode)                    │
│ }                                  │
│                                    │
│ Falla "suave" - usuario ve algo    │
└────────────────────────────────────┘
```

---

## 9. CASOS DE USO - EJEMPLOS REALES

### Caso 1: Clínica Pequeña

```
Hoy (LEGACY):
Cliente envía: "Hola, turno mañana a las 3"
Nosotros: Reenviamos

Mañana (MANAGED):
Cliente envía: Template + variables
Nosotros: Aplicamos template personalizado
→ "Hola Juan, recordamos tu turno mañana a las 15:00 con Dr. López"
```

### Caso 2: Cadena de Clínicas

```
Hoy (LEGACY):
- Clínica A: "Recordatorio de turno..."
- Clínica B: "Reminder appointment..."
- Clínica C: "Estimado/a, recordamos..."
(Inconsistencia total)

Mañana (MANAGED):
- Todas usan: "Hola {{nombre}}, recordamos tu turno {{fecha}} a {{hora}}..."
✅ Consistencia garantizada
```

### Caso 3: Multi-idioma

```
Hoy (LEGACY):
Cliente maneja traducciones manualmente
→ Error: Olvida traducir algo
→ Usuario recibe mezclado

Mañana (MANAGED):
Nosotros tenemos 1 template por idioma:
- es: "Hola {{nombre}}..."
- en: "Hello {{name}}..."
- pt: "Olá {{nome}}..."
✅ Automático según cliente_language
```

---

## 10. MÉTRICAS MEJORADAS

### Antes (Hoy)

```
Total mensajes enviados: 10,000
Total confirmaciones: 7,500
Total cancelaciones: 1,500
```

### Después (Con Templates)

```
Total mensajes enviados: 10,000
├─ Vía LEGACY mode: 2,000
└─ Vía MANAGED mode: 8,000

Por tipo de template:
├─ reminder_main:
│  └─ Confirmación: 85% ✅
├─ reminder_urgent:
│  └─ Confirmación: 92% ✅
└─ reminder_simple:
   └─ Confirmación: 78% ⚠️

A/B Testing:
├─ Template A: 85% confirmación
├─ Template B: 88% confirmación ✅ Ganador
└─ Template C: 81% confirmación
```

---

## 📋 RESUMEN VISUAL

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ACTUAL:   Cliente arma → Nosotros reenviamos              │
│  PROBLEMA: Inconsistencia, errores, sin control centrali    │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  PROPUESTO: Cliente proporciona → Nosotros construimos      │
│  BENEFICIO: Consistencia, control, escalabilidad            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

