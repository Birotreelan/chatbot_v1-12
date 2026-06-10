# Diagrama Visual: Modo Recordatorios vs Chatbot Completo

## 🔄 Comparativa de Flujos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SISTEMA DE CLIENTES                                │
└─────────────────────────────────────────────────────────────────────────────┘

                 CLIENTE MODE: CHATBOT_FULL                CLIENTE MODE: REMINDERS_ONLY
                       (Modo Completo)                          (Modo Recordatorios)
                            │                                             │
                            │                                             │
                    ┌───────▼────────┐                         ┌──────────▼────────┐
                    │  Sistema Externo│                         │  Sistema Externo │
                    │ (Clínica/ERP)   │                         │  (Clínica/ERP)   │
                    └────────┬────────┘                         └──────────┬───────┘
                             │                                             │
                    POST /api/send-template                 POST /api/send-template
                             │                                             │
                    ┌────────▼─────────────────────┐        ┌──────────────▼──────────┐
                    │ Plantilla: Recordatorio      │        │ Plantilla: Recordatorio  │
                    │ "Tu turno el 10/06 a 14:00" │        │ "Tu turno el 10/06..."   │
                    │ con la Dra. María"          │        │ con la Dra. María"       │
                    └────────┬─────────────────────┘        └──────────────┬──────────┘
                             │                                             │
                             │ MENSAJE ENVIADO AL USUARIO                  │ MENSAJE ENVIADO
                             │                                             │
                    ┌────────▼─────────────────────┐        ┌──────────────▼──────────┐
                    │         USUARIO               │        │        USUARIO          │
                    │  [Responde al mensaje]       │        │ [Responde al mensaje]  │
                    │                              │        │                        │
                    │ Usuario: "Confirmo!"         │        │ Usuario: "Confirmo!"   │
                    └────────┬─────────────────────┘        └──────────────┬──────────┘
                             │                                             │
                POST /api/process-message (userMessage)      POST /api/process-message
                             │                                             │
                    ┌────────▼──────────────────────────┐  ┌──────────────▼────────────┐
                    │  /lib/whatsapp.tsx                │  │  /lib/whatsapp.tsx         │
                    │  Router Principal                │  │  Router Principal          │
                    │                                  │  │                            │
                    │ 1. Obtener config               │  │ 1. Obtener config          │
                    │ 2. ¿clientMode===CHATBOT_FULL?  │  │ 2. ¿clientMode===CHATBOT.. │
                    │    ✓ SÍ (continue)              │  │    ✗ NO                    │
                    │                                  │  │                            │
                    │ 3. Ejecutar flujos normales     │  │ 3. ✓ REMINDERS_ONLY        │
                    │    ✓ Detectar paciente         │  │    ├─ Call reminder-handler│
                    │    ✓ Mostrar turnos            │  │    │                       │
                    │    ✓ Permitir reagendamiento   │  │    └─► (IR A RAMA DERECHA)│
                    │    etc...                       │  │                            │
                    │                                  │  │                            │
                    └────────┬──────────────────────────┘  └──────────────┬────────────┘
                             │                                             │
        ┌────────────────────┴─────────────────────┐     ┌────────────────▼─────────────┐
        │                                          │     │                               │
        │    FLUJO: Detectar Paciente Existente    │     │  reminder-mode-handler.ts    │
        │                                          │     │                               │
        │ 1. Buscar en DB por teléfono             │     │ 1. Procesar intención        │
        │ 2. Obtener turnos del paciente           │     │    ├─ Confirmar              │
        │ 3. Mostrar opciones:                     │     │    ├─ Cancelar               │
        │    a) Confirmar turno                    │     │    ├─ Despedir (silencio)    │
        │    b) Cancelar turno                     │     │    └─ Derivar               │
        │    c) Reagendar turno                    │     │                               │
        │    d) Hablar con agente                  │     │ 2. Buscar template apropiado │
        │                                          │     │    ├─ confirmationTemplate   │
        │ 4. Usuario elige → Procesar acción       │     │    ├─ cancellationTemplate   │
        │ 5. Guardar en DB                         │     │    └─ derivationTemplate     │
        │ 6. Enviar notificación a clínica        │     │                               │
        │                                          │     │ 3. Construir respuesta       │
        │ ✓ Resultado: Turno confirmado en BD      │     │    ├─ Insertar variables     │
        │                                          │     │    │  (fecha, hora, canales) │
        │                                          │     │    └─ Incluir derivación     │
        │                                          │     │                               │
        └────────────────────┬─────────────────────┘     │ 4. Enviar respuesta al user  │
                             │                           │                               │
                ┌────────────▼─────────────┐  ┌──────────▼───┐                         
                │   Responder al Usuario:  │  │  Responder:  │                         
                │                          │  │              │                         
                │ "Turno confirmado para   │  │ "¡Perfecto!  │                         
                │  el 10/06 a las 14:00    │  │  Confirmamos │                         
                │  con la Dra. María.      │  │  tu turno    │                         
                │                          │  │  para el     │                         
                │  Dirección:              │  │  10/06 a las │                         
                │  Av. Principal 123,      │  │  14:00"      │                         
                │  Piso 4                  │  │              │                         
                │                          │  │  [Si fue     │                         
                │  ¿Necesitas cambios?     │  │   cancelación]│                        
                │  Llama a 0800-123-4567"  │  │  "Si necesitas│                        
                │                          │  │  cambiar:    │                         
                │ [Información completa]   │  │              │                         
                └────────────────────────────┘  │  📱 Teléfono:│                        
                                                │      +54911..│                        
                                                │              │                        
                                                │  📧 Email:   │                        
                                                │   agendas@.. │                        
                                                │              │                        
                                                │  🌐 Web:     │                        
                                                │  clinic.com..|                        
                                                │              │                        
                                                │  [Mínimo e   │                        
                                                │   información]│                       
                                                └──────────────┘                        


┌──────────────────────────────────────────────────────────────────────────┐
│                    TABLA COMPARATIVA DE FUNCIONALIDADES                   │
├──────────────────────────────────────────────────────────────────────────┤
│                          │     CHATBOT_FULL    │    REMINDERS_ONLY       │
├──────────────────────────┼─────────────────────┼─────────────────────────┤
│ Enviar recordatorios     │         ✓           │           ✓             │
│ Confirmación automática  │         ✓           │           ✓             │
│ Cancelación automática   │         ✓           │           ✓             │
│ Reagendamiento           │         ✓           │           ✗             │
│ Paciente nuevo           │         ✓           │           ✗             │
│ Búsqueda de turnos       │         ✓           │           ✗             │
│ Chat conversacional      │         ✓           │           ✗             │
│ Escalamiento a agente    │         ✓           │           ✗             │
│                          │                     │                         │
│ Derivación a teléfono    │         ✓           │           ✓             │
│ Derivación a email       │         ✓           │           ✓             │
│ Derivación a web         │         ✓           │           ✓             │
│                          │                     │                         │
│ Templates editables      │      Globales       │      Por cliente        │
│ Canales de derivación    │      Predefinidos   │      Configurables      │
│ Control de flujo         │    Feature flags    │    Modo cliente         │
├──────────────────────────┴─────────────────────┴─────────────────────────┤
```

---

## 🔐 Matriz de Decisión en el Router

```
                    ┌─────────────────────────┐
                    │  Message Processing     │
                    │  /api/process-message   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Obtener WhatsAppConfig │
                    │  config.clientMode = ?  │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
       ┌─────────▼──────────────┐      ┌────────▼──────────────┐
       │   CHATBOT_FULL         │      │  REMINDERS_ONLY       │
       │                        │      │                       │
       │ ┌────────────────────┐ │      │ ┌────────────────────┐│
       │ │ Feature Flags      │ │      │ │ Reminder Handler   ││
       │ │ ON/OFF             │ │      │ │                    ││
       │ ├────────────────────┤ │      │ ├────────────────────┤│
       │ │directConfirmation? │ │      │ │ 1. Detectar        ││
       │ │directCancellation? │ │      │ │    intención       ││
       │ │directReagendamiento?
       │ │directPacienteNuevo?│ │      │ ├────────────────────┤│
       │ │...                 │ │      │ │ 2. Seleccionar     ││
       │ └────────────────────┘ │      │ │    template        ││
       │          │              │      │ │    (confirmar/     ││
       │          ▼              │      │ │     cancelar/      ││
       │ ┌────────────────────┐ │      │ │     derivar)       ││
       │ │ Ejecutar handlers  │ │      │ ├────────────────────┤│
       │ │ específicos        │ │      │ │ 3. Construir       ││
       │ │ (basado en flags)  │ │      │ │    respuesta con   ││
       │ └────────────────────┘ │      │ │    configuración   ││
       │          │              │      │ │    del cliente     ││
       │          ▼              │      │ └────────────────────┘│
       │ ┌────────────────────┐ │      │          │             │
       │ │ OpenAI + NLU       │ │      │          ▼             │
       │ │ (si flag = OFF)    │ │      │ ┌───────────────────┐ │
       │ └────────────────────┘ │      │ │ Enviar Respuesta  │ │
       │          │              │      │ │ (derivación       │ │
       │          ▼              │      │ │  personalizada)   │ │
       │ ┌────────────────────┐ │      │ └───────────────────┘ │
       │ │ Guardar métrica    │ │      │          │             │
       │ │ y responder        │ │      │          ▼             │
       │ └────────────────────┘ │      │ ┌───────────────────┐ │
       │                        │      │ │ Registrar métrica │ │
       └────────────┬───────────┘      │ │ (reminder_*)      │ │
                    │                  │ └───────────────────┘ │
                    │                  │          │             │
                    │                  │          ▼             │
                    │                  │ ┌───────────────────┐ │
                    │                  │ │ RETORNAR          │ │
                    │                  │ │ (sin pasar a      │ │
                    │                  │ │  flujos normales) │ │
                    │                  │ └───────────────────┘ │
                    │                  └───────────┬───────────┘
                    │                              │
                    └──────────────┬───────────────┘
                                   │
                       ┌───────────▼────────────┐
                       │  Response enviada al   │
                       │  usuario (WhatsApp)    │
                       └────────────────────────┘
```

---

## 💾 Modelo de Datos en Redis

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIGURACIÓN DEL CLIENTE                    │
│  Clave: config:{configId}                                       │
└─────────────────────────────────────────────────────────────────┘

┌─ CHATBOT_FULL MODE ─────────────────────────────────────────────┐
│                                                                  │
│  {                                                               │
│    "id": "cfg_123",                                             │
│    "displayName": "Clínica Central",                            │
│    "clientMode": "CHATBOT_FULL",                               │
│    "active": true,                                              │
│    "phoneNumberId": "123456789",                               │
│    "accessToken": "EAA...",                                    │
│    "escalationPhoneNumber": "+54 11 1234-5678",               │
│    "featureFlags": {                                            │
│      "directConfirmation": true,                               │
│      "directCancellation": true,                               │
│      "directReagendamiento": true,                             │
│      "directPacienteNuevo": true,                              │
│      // ... más flags ...                                      │
│    }                                                             │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─ REMINDERS_ONLY MODE ───────────────────────────────────────────┐
│                                                                  │
│  {                                                               │
│    "id": "cfg_456",                                             │
│    "displayName": "Consultorio Dermatología Dr. López",        │
│    "clientMode": "REMINDERS_ONLY",                             │
│    "active": true,                                              │
│    "phoneNumberId": "987654321",                               │
│    "accessToken": "EAA...",                                    │
│                                                                  │
│    "reminderConfig": {                                          │
│      "reminderTemplate": "Tu turno el {{fecha}} a las {{hora}} │
│                           con {{profesional}} en {{lugar}}.    │
│                           Confirma aquí o llama a 0800-1234",  │
│                                                                  │
│      "confirmationResponseTemplate": "¡Perfecto! Confirmamos   │
│                                        tu turno para           │
│                                        {{fecha}} a {{hora}}",   │
│                                                                  │
│      "cancellationResponseTemplate": "Entendido, hemos cancelado│
│                                        tu turno. Si necesitas  │
│                                        agendar nuevamente,     │
│                                        contáctanos:",          │
│                                                                  │
│      "derivationMessageTemplate": "¿Necesitas cambiar?         │
│                                    {{channels}}",               │
│                                                                  │
│      "derivationChannels": {                                    │
│        "phone": "+54 9 11 1234-5678",                         │
│        "email": "agendas@dermatologia.com.ar",                │
│        "web": "www.dermatologia.com.ar/agendar",              │
│        "whatsappBusiness": "+54 11 9876-5432"                 │
│      },                                                          │
│                                                                  │
│      "autoConfirmOnReply": true,                               │
│      "autoRejectOutOfWindow": false,                           │
│      "silenceOnFarewell": true                                 │
│    }                                                             │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│           ESTADO DE USUARIO EN MODO RECORDATORIOS                │
│  Clave: reminder_mode:{phoneNumber}:{configId}                  │
└─────────────────────────────────────────────────────────────────┘

{
  "phoneNumber": "+54911234567",
  "configId": "cfg_456",
  "mode": "REMINDERS_ONLY",
  
  "lastReminderTemplate": "Tu turno el 10/06...",
  "lastReminderSentAt": "2024-06-10T12:00:00Z",
  "lastReminderExternalId": "reminder_ext_789",
  
  "lastAction": {
    "type": "confirmed",                      # "confirmed" | "cancelled" | "silence"
    "at": "2024-06-10T12:15:00Z",
    "userMessage": "Confirmo!",
    "responseText": "¡Perfecto! Confirmamos tu turno..."
  },
  
  "derivationChannelsSent": ["phone", "email", "web"],
  "requiresDerivation": false
}
```

---

## 📊 Ejemplos de Flujo Completo

### Ejemplo 1: Usuario Confirma (REMINDERS_ONLY)

```
TIMELINE: 10/06/2024

12:00 PM - CLÍNICA ENVÍA RECORDATORIO
┌─────────────────────────────────────────────────┐
│ POST /api/send-template                         │
│ Body: {                                         │
│   Cliente_Id: "cfg_456",                        │
│   Telefono: "+54911234567",                     │
│   Template_Name: "recordatorio_turno",          │
│   Body: "Tu turno el 10/06 a las 14:00 con     │
│          la Dra. María en Av. Principal 123"    │
│ }                                               │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ ✓ Plantilla enviada al usuario                  │
│ Usuario recibe: "Tu turno el 10/06 a las 14:00│
│                  con la Dra. María..."          │
└──────────────────────────┬──────────────────────┘
                           │
12:30 PM - USUARIO RESPONDE
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ Usuario envía: "Confirmo!"                      │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ POST /api/process-message                       │
│ {                                               │
│   phoneNumber: "+54911234567",                  │
│   configId: "cfg_456",                          │
│   userMessage: "Confirmo!"                      │
│ }                                               │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ whatsapp.tsx:                                   │
│ 1. Obtener config                               │
│ 2. ¿clientMode === "REMINDERS_ONLY"? ✓ SÍ      │
│ 3. Llamar reminder-mode-handler                 │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ reminder-mode-handler:                          │
│ 1. Detectar intención: "Confirmo!"              │
│    → Regex matches confirmación ✓               │
│ 2. Obtener confirmationResponseTemplate:        │
│    "¡Perfecto! Confirmamos tu turno para       │
│     {{fecha}} a {{hora}}"                       │
│ 3. Construir respuesta:                         │
│    "¡Perfecto! Confirmamos tu turno para       │
│     10/06 a 14:00"                              │
│ 4. Retornar respuesta                           │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ Enviar WhatsApp al usuario:                     │
│ "¡Perfecto! Confirmamos tu turno para          │
│  10/06 a 14:00"                                 │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ Registrar métrica:                              │
│ reminder_confirmed:{phoneNumber}:{configId}    │
│ {                                               │
│   timestamp: "2024-06-10T12:30:00Z",           │
│   userMessage: "Confirmo!",                    │
│   responseText: "¡Perfecto! Confirmamos..."    │
│ }                                               │
└─────────────────────────────────────────────────┘

✓ TERMINADO - No pasa a flujos normales de chatbot
```

### Ejemplo 2: Usuario Cancela (REMINDERS_ONLY)

```
TIMELINE: 10/06/2024

12:00 PM - CLÍNICA ENVÍA RECORDATORIO
(igual al anterior)
                           ...
13:15 PM - USUARIO CANCELA
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ Usuario envía: "No puedo ir"                    │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ reminder-mode-handler:                          │
│ 1. Detectar intención: "No puedo ir"            │
│    → Regex matches cancelación ✓                │
│ 2. Obtener cancellationResponseTemplate:        │
│    "Entendido, hemos cancelado tu turno.       │
│     Si necesitas agendar: {{channels}}"         │
│ 3. Construir respuesta con derivación:          │
│    "Entendido, hemos cancelado tu turno.       │
│                                                  │
│     Si necesitas agendar nuevamente:            │
│     📱 Teléfono: +54 9 11 1234-5678            │
│     📧 Email: agendas@dermatologia.com.ar      │
│     🌐 Web: www.dermatologia.com.ar/agendar"   │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ Enviar WhatsApp al usuario:                     │
│ "Entendido, hemos cancelado tu turno.          │
│                                                  │
│  Si necesitas agendar nuevamente:               │
│  📱 Teléfono: +54 9 11 1234-5678               │
│  📧 Email: agendas@dermatologia.com.ar         │
│  🌐 Web: www.dermatologia.com.ar/agendar"      │
└──────────────────────────┬──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────┐
│ Registrar métrica:                              │
│ reminder_cancelled:{phoneNumber}:{configId}    │
│ Registrar derivación enviada                    │
└─────────────────────────────────────────────────┘

✓ TERMINADO - Usuario derivado a otros canales
```

---

## 🎨 Dashboard UI Mockup

```
┌──────────────────────────────────────────────────────────────────┐
│  Editar Configuración: Clínica Central                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [← Volver]  [Guardar]  [Cancelar]                               │
│                                                                   │
│  ┌─ INFORMACIÓN BÁSICA ────────────────────────────────────────┐ │
│  │ Nombre: Clínica Central                     │
│  │ Número WhatsApp: +54 11 1234-5678          │
│  │ Estado: ☑ Activa   ☐ Pausada               │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ MODO DE OPERACIÓN ─────────────────────────────────────────┐ │
│  │ ◉ Chatbot Completo                                           │ │
│  │   (confirmación, reagendamiento, pacientes nuevos)          │ │
│  │                                                               │ │
│  │ ○ Solo Recordatorios                                         │ │
│  │   (recordatorios, confirmación/cancelación, derivación)     │ │
│  │                                                               │ │
│  │ [Si selecciona "Solo Recordatorios"]                         │ │
│  │                                                               │ │
│  │ ┌─ PLANTILLAS DE RECORDATORIOS ─────────────────────────┐  │ │
│  │ │ Plantilla de Recordatorio:                            │  │ │
│  │ │ ┌─────────────────────────────────────────────────┐  │  │ │
│  │ │ │ Tu turno el {{fecha}} a las {{hora}}             │  │  │ │
│  │ │ │ con {{profesional}} en {{lugar}}.                │  │  │ │
│  │ │ │                                                   │  │  │ │
│  │ │ │ Confirma aquí o llama para cambiar               │  │  │ │
│  │ │ └─────────────────────────────────────────────────┘  │  │ │
│  │ │ [Reiniciar] [Guardar template]                        │  │ │
│  │ │                                                        │  │ │
│  │ │ Plantilla de Confirmación:                            │  │ │
│  │ │ ┌─────────────────────────────────────────────────┐  │  │ │
│  │ │ │ ¡Perfecto! Confirmamos tu turno                │  │  │ │
│  │ │ │ para {{fecha}} a {{hora}} con {{profesional}}   │  │  │ │
│  │ │ └─────────────────────────────────────────────────┘  │  │ │
│  │ │ [Guardar template]                                    │  │ │
│  │ │                                                        │  │ │
│  │ │ Plantilla de Cancelación:                             │  │ │
│  │ │ ┌─────────────────────────────────────────────────┐  │  │ │
│  │ │ │ Entendido, hemos cancelado tu turno.            │  │  │ │
│  │ │ │                                                  │  │  │ │
│  │ │ │ Si necesitas agendar: {{channels}}               │  │  │ │
│  │ │ └─────────────────────────────────────────────────┘  │  │ │
│  │ │ [Guardar template]                                    │  │ │
│  │ └────────────────────────────────────────────────────────┘  │ │
│  │                                                               │ │
│  │ ┌─ CANALES DE DERIVACIÓN ─────────────────────────────────┐ │ │
│  │ │ ☑ Teléfono:  +54 9 11 1234-5678  [x]                  │ │ │
│  │ │ ☑ Email:     agendas@clinica.com  [x]                 │ │ │
│  │ │ ☑ Web:       www.clinica.com/agendar  [x]             │ │ │
│  │ │ ☑ WhatsApp:  +54 11 9876-5432     [x]                 │ │ │
│  │ │                                                          │ │ │
│  │ │ [+ Agregar canal]                                      │ │ │
│  │ └────────────────────────────────────────────────────────┘ │ │
│  │                                                               │ │
│  │ ┌─ OPCIONES AVANZADAS ──────────────────────────────────────┐ │ │
│  │ │ ☑ Confirmar automáticamente al responder                 │ │ │
│  │ │ ☐ Rechazar mensajes fuera de ventana 24h               │ │ │
│  │ │ ☑ Silencio si responden con despedida                  │ │ │
│  │ └────────────────────────────────────────────────────────────┘ │ │
│  │                                                               │ │
│  │ [Vista Previa del Usuario] ──┐                             │ │
│  │                               │                             │ │
│  │                               ▼                             │ │
│  │  ┌────────────────────────────────────────────┐            │ │
│  │  │ WhatsApp del Usuario                       │            │ │
│  │  ├────────────────────────────────────────────┤            │ │
│  │  │                                             │            │ │
│  │  │ Tu turno el 10/06 a las 14:00              │            │ │
│  │  │ con la Dra. María en Av. Principal 123     │            │ │
│  │  │                                             │            │ │
│  │  │ Confirma aquí o llama para cambiar         │            │ │
│  │  │                                             │            │ │
│  │  │  [Botón: Confirmar]                        │            │ │
│  │  │                                             │            │ │
│  │  └────────────────────────────────────────────┘            │ │
│  │  [Usuario responde: "Confirmo"]                            │ │
│  │                                                            │ │
│  │  ┌────────────────────────────────────────────┐            │ │
│  │  │ Bot responde:                              │            │ │
│  │  │ ¡Perfecto! Confirmamos tu turno para      │            │ │
│  │  │ 10/06 a las 14:00 con la Dra. María       │            │ │
│  │  └────────────────────────────────────────────┘            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  [Guardar Cambios]  [Cancelar]  [Testear Envío]  [Descargar]    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```
