# Implementación Multi-Usuario SSO

## Resumen del Problema Resuelto

Anteriormente, el sistema no diferenciaba entre usuarios al momento de tomar una conversación. Todos los usuarios de un tenant veían las MISMAS conversaciones activas, lo que causaba conflictos cuando múltiples agentes querían trabajar en paralelo.

## Solución Implementada

### 1. **Extracción de Datos del Token SSO**

El token SSO ahora proporciona tres parámetros clave para identificar al usuario:
- `usuario_id`: ID único del usuario dentro del cliente
- `nombre`: Nombre del usuario
- `apellido`: Apellido del usuario

**Cambios en `lib/sso.ts`:**
```typescript
export interface SSOTokenPayload {
  cliente_id: string;
  usuario_id?: string;  // ID único del usuario dentro del cliente
  apellido?: string;    // Apellido del usuario
  nombre?: string;      // Nombre del usuario
  // ... campos existentes
}
```

### 2. **Almacenamiento de Identidad del Usuario en la Sesión**

La sesión ahora almacena el `ssoUsuarioId` para identificar de forma única a cada usuario SSO dentro del tenant.

**Cambios en `lib/types.ts`:**
```typescript
export interface SessionData {
  userId: string
  username: string
  role: "super_admin" | "support_agent"
  tenantId: string | null
  displayName: string
  ssoUsuarioId?: string  // ← Nuevo: ID del usuario SSO único
}
```

### 3. **Creación de userId Único Globalmente**

En `app/api/auth/sso/route.ts`, el `userId` se construye combinando `cliente_id` + `usuario_id`:

```typescript
const ssoUsuarioId = usuario_id || `sso_${cliente_id}_${nanoid(8)}`;

const sessionData: SessionData = {
  userId: `sso_${cliente_id}_${ssoUsuarioId}`,  // ← Único globalmente
  username: email || `usuario_${ssoUsuarioId}`,
  role: 'support_agent',
  tenantId: cliente_id,
  displayName: userDisplayName,  // nombre + apellido del token
  ssoUsuarioId: ssoUsuarioId,    // Guardar para filtrar conversaciones
};
```

### 4. **Filtrado de Conversaciones por Usuario**

En `app/api/support/sessions/route.ts`, ahora se filtran las conversaciones ACTIVAS por el `userId` del usuario actual, no por el `tenantId`:

```typescript
// Conversaciones pendientes: TODOS los usuarios del tenant pueden verlas
const pendingSessions = await getPendingSessions(session.tenantId)

// Conversaciones activas: SOLO las asignadas al usuario actual
const activeSessions = await getAgentActiveSessions(session.userId)
```

### 5. **Mejoras en la UI del Dashboard**

El dashboard ahora:
- Muestra el nombre del usuario logueado
- Diferencia claramente entre "Conversaciones Pendientes" (compartidas) y "Mis Conversaciones Activas" (del usuario actual)
- Incluye descripciones aclaratorias

**Cambios en `components/support/support-dashboard.tsx`:**
```typescript
<div className="mb-4">
  <h2 className="text-xl font-semibold">Conversaciones Pendientes ({pendingSessions.length})</h2>
  <p className="text-sm text-muted-foreground">
    Conversaciones esperando ser atendidas (visibles para todos los agentes)
  </p>
</div>

<div className="mb-4">
  <h2 className="text-xl font-semibold">Mis Conversaciones Activas ({activeSessions.length})</h2>
  <p className="text-sm text-muted-foreground">
    Conversaciones que TU estás atendiendo actualmente
  </p>
</div>
```

## Flujo de Funcionamiento Multiusuario

### Escenario: 3 Agentes en el mismo tenant

1. **Agente 1 (usuario_id: 101, nombre: "Juan"):**
   - Se loguea con token SSO
   - `userId` = `sso_cliente_1_101`
   - Ve: Conversaciones Pendientes (5) + Sus Conversaciones Activas (2)

2. **Agente 2 (usuario_id: 102, nombre: "María"):**
   - Se loguea con token SSO
   - `userId` = `sso_cliente_1_102`
   - Ve: Las MISMAS Conversaciones Pendientes (5) + Sus Conversaciones Activas (0)

3. **Agente 3 (usuario_id: 103, nombre: "Pedro"):**
   - Se loguea con token SSO
   - `userId` = `sso_cliente_1_103`
   - Ve: Las MISMAS Conversaciones Pendientes (5) + Sus Conversaciones Activas (3)

### Asignación de Conversaciones

Cuando cualquiera de los 3 agentes toma una conversación pendiente:
1. Se marca como `status: "in_progress"`
2. Se asigna a su `userId` específico
3. Los otros agentes YA NO la ven en "Mis Conversaciones Activas"
4. La conversación desaparece de "Conversaciones Pendientes" para TODOS

## Logs para Depuración

El sistema genera logs detallados en cada paso:

```
[SSO API] Datos extraídos del token: { cliente_id, email, usuario_id, nombre, apellido }
[SSO API] Creando sesión con datos: { userId, ssoUsuarioId, displayName, ... }
[API Sessions] Sesión obtenida: { userId, tenantId, ssoUsuarioId, ... }
[API Sessions] Sesiones pendientes encontradas: X
[API Sessions] Sesiones activas del agente (userId: XXX): Y
```

Estos logs aparecen en:
- Console del servidor (logs del backend)
- Devtools del navegador (logs del frontend)

## Archivos Modificados

1. `lib/sso.ts` - Tipos del token SSO
2. `lib/types.ts` - Tipo SessionData
3. `app/api/auth/sso/route.ts` - Lógica de login SSO
4. `app/api/support/sessions/route.ts` - Filtrado de sesiones
5. `lib/human-support.ts` - Logging mejorado
6. `components/support/support-dashboard.tsx` - UI mejorada

## Próximos Pasos (Opcional)

- [ ] Agregar auditoría: quién tomó la conversación y cuándo
- [ ] Mostrar "Agente: Juan" en conversaciones asignadas
- [ ] Permitir reasignar conversaciones entre agentes
- [ ] Notificar a todos cuando una conversación es tomada
