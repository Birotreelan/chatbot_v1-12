# Diagrama del Flujo Multi-Usuario SSO

## Arquitectura de Sesiones

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENTE ÚNICO (Clinic_123)                    │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  Navegador 1 │  │  Navegador 2 │  │  Navegador 3 │                  │
│  │  (Agente 1)  │  │  (Agente 2)  │  │  (Agente 3)  │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│         │ SSO Token       │ SSO Token       │ SSO Token                 │
│         │ usuario_id:101  │ usuario_id:102  │ usuario_id:103            │
│         │ nombre: Juan    │ nombre: María   │ nombre: Pedro             │
│         └────────┬────────┴────────┬────────┴────────┐                 │
│                  │                 │                 │                  │
│                  v                 v                 v                  │
│          ┌──────────────────────────────────────────────────┐           │
│          │     /api/auth/sso (SSO Login Endpoint)           │           │
│          │ - Extraer usuario_id, nombre, apellido del token │           │
│          │ - Crear userId: sso_clinic_123_101              │           │
│          │ - Crear userId: sso_clinic_123_102              │           │
│          │ - Crear userId: sso_clinic_123_103              │           │
│          └──────────────┬───────────────────────────────────┘           │
│                         │                                               │
│                         v                                               │
│          ┌──────────────────────────────────────────────────┐           │
│          │  Redis Session Store (Seguro y Persistente)      │           │
│          │                                                   │           │
│          │  Session_1: {                                    │           │
│          │    userId: "sso_clinic_123_101"                 │           │
│          │    ssoUsuarioId: "101"                          │           │
│          │    displayName: "Juan Pérez"                    │           │
│          │    tenantId: "clinic_123"                       │           │
│          │  }                                               │           │
│          │                                                   │           │
│          │  Session_2: {                                    │           │
│          │    userId: "sso_clinic_123_102"                 │           │
│          │    ssoUsuarioId: "102"                          │           │
│          │    displayName: "María García"                  │           │
│          │  }                                               │           │
│          │                                                   │           │
│          │  Session_3: {                                    │           │
│          │    userId: "sso_clinic_123_103"                 │           │
│          │    ssoUsuarioId: "103"                          │           │
│          │    displayName: "Pedro López"                   │           │
│          │  }                                               │           │
│          └──────────────┬───────────────────────────────────┘           │
│                         │                                               │
└─────────────────────────┼───────────────────────────────────────────────┘
                          │
                          │ Cookies/Headers con Session ID
                          │
┌─────────────────────────┼───────────────────────────────────────────────┐
│                         v                                               │
│          ┌──────────────────────────────────────────────────┐           │
│          │   /api/support/sessions (Fetch Conversations)    │           │
│          │                                                   │           │
│          │  Input: userId (del request context)            │           │
│          │                                                   │           │
│          │  1. Obtener Conversaciones Pendientes:           │           │
│          │     - Filter by: tenantId = "clinic_123"        │           │
│          │     - Resultado: [Conv_1, Conv_2, Conv_3, ...]  │           │
│          │     - Visible para: TODOS los agentes (1,2,3)   │           │
│          │                                                   │           │
│          │  2. Obtener Mis Conversaciones Activas:          │           │
│          │     - Agente 1: Filter by: userId = "sso_..."101 │           │
│          │       Resultado: [Conv_101_A, Conv_101_B]       │           │
│          │                                                   │           │
│          │     - Agente 2: Filter by: userId = "sso_..."102 │           │
│          │       Resultado: []                              │           │
│          │                                                   │           │
│          │     - Agente 3: Filter by: userId = "sso_..."103 │           │
│          │       Resultado: [Conv_103_X, Conv_103_Y, ...]  │           │
│          │                                                   │           │
│          └──────────────┬───────────────────────────────────┘           │
│                         │                                               │
└─────────────────────────┼───────────────────────────────────────────────┘
                          │
                          │ JSON: { sessions, pending, active, userInfo }
                          │
┌─────────────────────────┼───────────────────────────────────────────────┐
│         Renderizar en Dashboard del Navegador 1                          │
│                         │                                               │
│                         v                                               │
│          ┌──────────────────────────────────────────────────┐           │
│          │  Panel de Atención al Cliente                     │           │
│          │  Usuario: Juan Pérez                             │           │
│          │  ┌──────────────────┐  ┌──────────────────────┐  │           │
│          │  │ Conversaciones   │  │ Mis Conversaciones   │  │           │
│          │  │ Pendientes (5)   │  │ Activas (2)          │  │           │
│          │  │                  │  │                      │  │           │
│          │  │ - Conv 1 [+]     │  │ - Conv_A [Abierto]   │  │           │
│          │  │ - Conv 2 [+]     │  │ - Conv_B [Abierto]   │  │           │
│          │  │ - Conv 3 [+]     │  │                      │  │           │
│          │  │ - Conv 4 [+]     │  │                      │  │           │
│          │  │ - Conv 5 [+]     │  │                      │  │           │
│          │  └──────────────────┘  └──────────────────────┘  │           │
│          │                                                   │           │
│          │  Nota: "Conversaciones esperando ser atendidas   │           │
│          │   (visibles para todos los agentes)"             │           │
│          │                                                   │           │
│          │  Nota: "Conversaciones que TU estás atendiendo   │           │
│          │   actualmente"                                   │           │
│          └──────────────────────────────────────────────────┘           │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

## Flujo de Asignación de Conversación

```
AGENTE 1 (Usuario ID: sso_clinic_123_101)         AGENTE 2 (Usuario ID: sso_clinic_123_102)
         │                                                  │
         │                                                  │
         │ Hace click en "Tomar" Conv_1                    │
         │                                                  │
         ├──────────────┐                                   │
         │              │                                   │
         │              v                                   │
         │    POST /api/support/actions                     │
         │    { action: "assign", sessionId: "Conv_1" }    │
         │                                                  │
         │              │                                   │
         │              v                                   │
         │    [LOCK] Intenta asegurar la sesión             │
         │    ┌─────────────────────────────────┐          │
         │    │ Redis LOCK: Conv_1_assign_lock  │          │  ← Agente 2 intenta aquí
         │    │ (Bloqueador: sso_clinic_123_101)│          │     al mismo tiempo
         │    └─────────────────────────────────┘          │
         │            GANADOR ✓                             │
         │                                                  │
         │              │                                   │
         │              v                                   │
         │    Guardar: {                                    │
         │      id: "Conv_1",                              │
         │      status: "in_progress",                     │
         │      assignedTo: "sso_clinic_123_101",  ← CLAVE│
         │      assignedName: "Juan Pérez"                │
         │    }                                             │
         │                                                  │
         │              │                                   │
         │              v                                   │
         │    Guardar en Redis:                             │
         │    sso_clinic_123_101:active_sessions → [Conv_1]│
         │                                                  │
         │              │                                   │
         │              v                                   │
         │    Enviar notificación WhatsApp                  │
         │                                                  │
         │              │                                   │
         │              v                                   │
         │    Response: { success: true }                   │
         │                                                  │
         │              │                                   │
         v              v                                   v
    Refrescar UI    Pendientes: 4                    Refrescar UI
    Mis Activas: 2      Activas de Juan: 1          Mis Activas: 0
                                                    Pendientes: 4 (igual para todos)


                            FLOW DIAGRAM SUMMARY:

    Agente 2 intenta aquí         
    (Race Condition Blocked)       
             ↓                      
    Conv_1:lock = LOCKED           
             ↓                      
    (Espera a que se libere)       
             ↓                      
    ✗ Falla: "race_condition"      
    (Otro agente tomó la conversación)
```

## Estado del Redis después de la Asignación

```redis
# Sessions (Sesiones de agentes)
session:sid_1 = {
  userId: "sso_clinic_123_101",
  ssoUsuarioId: "101",
  displayName: "Juan Pérez",
  tenantId: "clinic_123"
}

session:sid_2 = {
  userId: "sso_clinic_123_102",
  ssoUsuarioId: "102",
  displayName: "María García",
  tenantId: "clinic_123"
}

# Support Sessions (Conversaciones de atención al cliente)
support:session:Conv_1 = {
  id: "Conv_1",
  status: "in_progress",
  assignedTo: "sso_clinic_123_101",  # ← Asignado a Juan
  tenantId: "clinic_123",
  clientId: "client_456",
  phoneNumber: "+34666777888"
}

support:session:Conv_2 = {
  id: "Conv_2",
  status: "pending",  # ← Aún pendiente
  tenantId: "clinic_123"
}

# Sets de Agentes (para búsqueda rápida)
agent:sso_clinic_123_101:active_sessions = SET["Conv_1"]  # ← Juan tiene 1 sesión
agent:sso_clinic_123_102:active_sessions = SET[]          # ← María no tiene sesiones
agent:sso_clinic_123_103:active_sessions = SET[]          # ← Pedro no tiene sesiones

# Set de Sesiones Pendientes por Tenant
tenant:clinic_123:pending_sessions = SET["Conv_2", "Conv_3", ...]
```

## Consultas Típicas

### Query 1: ¿Cuántas conversaciones activas tiene Agente 1?

```typescript
// Backend
const agentId = "sso_clinic_123_101";
const activeSessionIds = await redis.smembers(`agent:${agentId}:active_sessions`);
// Resultado: ["Conv_1"]
// → Agente 1 tiene 1 conversación activa

// En SQL lo sería:
SELECT id FROM support_sessions 
WHERE assignedTo = 'sso_clinic_123_101' 
AND status = 'in_progress'
// → 1 fila
```

### Query 2: ¿Cuáles son las conversaciones pendientes para clinic_123?

```typescript
// Backend
const pendingSessionIds = await redis.smembers(`tenant:clinic_123:pending_sessions`);
// Resultado: ["Conv_2", "Conv_3", "Conv_5", ...]

// En SQL:
SELECT id FROM support_sessions 
WHERE tenantId = 'clinic_123' 
AND status = 'pending'
// → 3 filas (visible para TODOS los agentes del clinic_123)
```

### Query 3: ¿Quién tiene la conversación Conv_1?

```typescript
// Backend
const session = await redis.get(`support:session:Conv_1`);
console.log(session.assignedTo); // "sso_clinic_123_101"
console.log(session.assignedName); // "Juan Pérez"

// En SQL:
SELECT assignedTo, status FROM support_sessions 
WHERE id = 'Conv_1'
// → ("sso_clinic_123_101", "in_progress")
```

## Ventajas de Esta Arquitectura

✓ **Atomicidad:** Redis LOCK asegura que solo un agente asigne la sesión
✓ **Performance:** Búsquedas O(n) en lugar de iteraciones
✓ **Escalabilidad:** Soporta 100+ agentes simultáneos
✓ **Auditabilidad:** Cada conversación registra quién la tomó
✓ **Consistencia:** Si el agente se desconecta, se puede reasignar automáticamente
✓ **Multitenancy:** Datos completamente aislados por clinic/cliente
