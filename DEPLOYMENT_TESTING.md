# Guía de Testing para Multi-Usuario SSO

## Cómo Probar Localmente

### Requisitos
- 2-3 navegadores o perfiles de navegador diferentes
- Token SSO válido para cada usuario
- Misma `cliente_id` pero diferente `usuario_id`

### Paso 1: Preparar Tokens SSO

En tu sistema de generación de tokens SSO, crear 3 tokens diferentes:

```json
// Agente 1
{
  "cliente_id": "clinic_123",
  "usuario_id": "user_101",
  "nombre": "Juan",
  "apellido": "Pérez",
  "email": "juan@clinic.com"
}

// Agente 2
{
  "cliente_id": "clinic_123",
  "usuario_id": "user_102",
  "nombre": "María",
  "apellido": "García",
  "email": "maria@clinic.com"
}

// Agente 3
{
  "cliente_id": "clinic_123",
  "usuario_id": "user_103",
  "nombre": "Pedro",
  "apellido": "López",
  "email": "pedro@clinic.com"
}
```

### Paso 2: Testing de Login

1. Abrir navegador 1 y hacer login con token de Agente 1
   - Verificar que aparezca: "Usuario: Juan Pérez"
   - Verificar que `userId` = `sso_clinic_123_user_101`

2. Abrir navegador 2 y hacer login con token de Agente 2
   - Verificar que aparezca: "Usuario: María García"
   - Verificar que `userId` = `sso_clinic_123_user_102`

3. Abrir navegador 3 y hacer login con token de Agente 3
   - Verificar que aparezca: "Usuario: Pedro López"
   - Verificar que `userId` = `sso_clinic_123_user_103`

### Paso 3: Testing de Conversaciones Pendientes

En los 3 navegadores:
- Todas deben mostrar el MISMO listado en "Conversaciones Pendientes"
- Ejemplo: 5 conversaciones esperando

### Paso 4: Testing de Asignación de Conversaciones

**Navegador 1 (Juan):**
1. Tomar la 1ª conversación pendiente (click en botón "Tomar")
2. Se mueve a "Mis Conversaciones Activas" de Juan
3. Logs esperados:
   ```
   [ASSIGN] Usuario SSO - ID: user_101 Display: Juan Pérez
   [ASSIGN] ✓ Asignando sesión al agente: { agentSsoId: user_101, agentName: "Juan Pérez" }
   [ASSIGN] Resultado de asignación: ✓ ÉXITO
   ```

**Navegador 2 (María):**
1. DEBE VER UNA conversación MENOS en "Conversaciones Pendientes" (ahora 4)
2. "Mis Conversaciones Activas" de María sigue en 0
3. Logs en Navegador 2:
   ```
   [API Sessions] Sesiones activas del agente (userId: sso_clinic_123_user_102): 0
   ```

**Navegador 3 (Pedro):**
1. DEBE VER UNA conversación MENOS en "Conversaciones Pendientes" (ahora 4)
2. "Mis Conversaciones Activas" de Pedro sigue en 0

**Navegador 1 (Juan):**
1. Tomar OTRA conversación pendiente
2. Ahora Juan tiene 2 en "Mis Conversaciones Activas"
3. Conversaciones Pendientes = 3 para todos

### Paso 5: Testing de Race Condition

**Navegador 1 y Navegador 2 simultáneamente:**
1. Ambos intentan tomar la MISMA conversación pendiente en < 1 segundo
2. Uno DEBE tener éxito, otro DEBE recibir: `"reason": "race_condition"`
3. La conversación aparece SOLO en "Mis Conversaciones Activas" del ganador
4. Logs del perdedor:
   ```
   [ASSIGN] ⚠️ RACE CONDITION: Otro agente tomó la sesión
   [ASSIGN] Sesión ahora asignada a: sso_clinic_123_user_102
   ```

### Paso 6: Testing de Cierre de Conversación

**Navegador 1 (Juan):**
1. Cerrar una de sus conversaciones activas
2. Conversación desaparece de "Mis Conversaciones Activas"
3. Conversación NO vuelve a "Conversaciones Pendientes" (se cierra)

### Paso 7: Refresh y Persistencia

**Navegador 1 (Juan):**
1. Refrescar la página (F5)
2. Debe recuperar las MISMAS conversaciones activas que tenía
3. Logs esperados:
   ```
   [API Sessions] Sesión obtenida: { userId: sso_clinic_123_user_101, ... }
   [API Sessions] Sesiones activas del agente (userId: sso_clinic_123_user_101): 2
   ```

## Casos de Prueba Críticos

### ✓ FUNCIONA CORRECTAMENTE si...

- [ ] Cada usuario ve SOLO sus conversaciones activas
- [ ] Todos comparten las conversaciones pendientes
- [ ] Una conversación asignada desaparece de pendientes para TODOS
- [ ] No hay "duplicate sessions" para el mismo usuario
- [ ] Los nombres de usuarios aparecen correctamente
- [ ] Race conditions se resuelven sin corrupción de datos
- [ ] Los logs muestran el SSO usuarioId y nombre del agente

### ✗ BUG si...

- [ ] Dos usuarios ven la MISMA conversación en "Mis Conversaciones Activas"
- [ ] Un usuario ve las conversaciones activas de otro usuario
- [ ] El nombre del usuario sigue siendo "sso_cliente_xyz_random"
- [ ] "Conversaciones Pendientes" tiene duplicados
- [ ] Refrescar la página pierde las conversaciones activas

## Logs para Monitorear

### Frontend (Console del Navegador)
```javascript
// En DevTools > Console, buscar estos logs:
[API Sessions] Sesión obtenida
[API Sessions] Sesiones activas del agente
```

### Backend (Logs del Servidor)
```
[SSO API] Datos extraídos del token
[SSO API] Creando sesión con datos
[ASSIGN] Usuario SSO
[ASSIGN] ✓ Asignando sesión al agente
```

## Integración en CI/CD

Cuando esté listo, esta funcionalidad debe testearse con:

1. **Automated tests:** Crear fixtures con 3 usuarios SSO diferentes
2. **Load tests:** Verificar que múltiples usuarios concurrentes no causen race conditions
3. **Integration tests:** Verificar que el sistema de auditoría registre quién tomó cada conversación

## Notas Importantes

- El `usuario_id` debe ser ÚNICO dentro de cada cliente
- Si `usuario_id` no viene en el token SSO, se genera un UUID fallback
- Los userId globales son: `sso_{cliente_id}_{usuario_id}`
- El sistema está diseñado para soportar 100+ usuarios simultáneos por tenant
