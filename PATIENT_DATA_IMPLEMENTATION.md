# Implementación: Integración de Datos del Paciente en Panel de Atención al Cliente

## Resumen
Se ha implementado la integración de datos reales del paciente en el "Panel de Atención al Cliente". Los agentes ahora pueden ver información completa del paciente mientras atienden sus conversaciones.

## Cambios Implementados

### 1. Nuevo Endpoint API: `/api/support/patient` ✅
**Archivo:** `app/api/support/patient/route.ts`

**Funcionalidad:**
- Obtiene datos del paciente por número de teléfono
- Requiere autenticación (verificar que el usuario es agente de soporte)
- Retorna:
  - Datos del paciente (nombre, DNI, email, teléfono)
  - Turnos próximos (si existen)
  - Indicador de paciente nuevo (`es_primera_vez`)
  - Mensaje amigable si no se encuentra el paciente

**Parámetros:**
```
GET /api/support/patient?phoneNumber=+54911234567&clienteId=123
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "patient": {
    "nombre": "Juan Pérez",
    "dni": "12.345.678",
    "email": "juan@email.com",
    "telefono": "+54 9 11 1234-5678"
  },
  "turnos_proximos": [
    {
      "fecha": "2024-01-15",
      "hora": "10:00",
      "profesional": "Dr. García",
      "especialidad": "Cardiología"
    }
  ],
  "es_primera_vez": false
}
```

**Respuesta paciente no encontrado:**
```json
{
  "success": true,
  "patient": null,
  "es_primera_vez": true,
  "message": "Paciente no encontrado. Este es un cliente nuevo."
}
```

---

### 2. Nuevo Componente: `PatientInfoPanel` ✅
**Archivo:** `components/support/patient-info-panel.tsx`

**Funcionalidades:**
- Muestra información detallada del paciente en un panel lateral
- Carga datos al iniciar (con caché de 2-3 minutos para evitar recargas innecesarias)
- **Indicador Visual**: Badge "Paciente Nuevo 🆕" si es primera vez
- **Estados de carga**: Skeleton loaders mientras se obtienen datos
- **Gestión de errores**: Mensajes claros si hay problemas
- **Datos mostrados:**
  - Nombre completo del paciente
  - DNI
  - Teléfono
  - Email
  - **Próximos Turnos** (lista desplegable si hay turnos)
    - Fecha y hora
    - Profesional/Especialidad
    - Lugar/Sede

**Props:**
```typescript
interface PatientInfoPanelProps {
  sessionId: string
}
```

**Características:**
- Hook personalizado `usePatientData()` para manejar la lógica de fetching
- Caché local para evitar llamadas repetidas
- Interfaz responsiva (funciona en móvil y desktop)
- Manejo de estados: loading, error, success
- Refreshable: Botón para actualizar datos manualmente

---

### 3. Layout Actualizado: `ConversationView` ✅
**Archivo:** `components/support/conversation-view.tsx`

**Cambios:**
- Layout de **dos columnas** usando CSS Grid responsivo:
  - **Columna 1 (responsive)**: Panel de información del paciente
  - **Columna 2 (principal)**: Conversación e historial de mensajes
  
- En **móviles** (< 1024px): Panel del paciente arriba, conversación abajo
- En **desktop** (>= 1024px): Panel a la izquierda (33%), conversación a la derecha (67%)

- Importa `PatientInfoPanel` en la conversación
- Mantiene todas las funcionalidades existentes: cerrar sesión, enviar mensajes, etc.

---

### 4. Tipos Agregados: `lib/api-tools/types.ts` ✅
**Interfaces nuevas:**
```typescript
interface Paciente {
  id?: string
  nombre?: string
  apellido?: string
  nombre_completo?: string
  dni?: string
  email?: string
  telefono?: string
  fecha_nacimiento?: string
  direccion?: string
  provincia?: string
  obra_social?: string
  [key: string]: any
}

interface Cita {
  id?: string
  fecha?: string
  hora?: string
  profesional?: string
  especialidad?: string
  lugar?: string
  estado?: string
}

interface ApiResponse<T> {
  exito: boolean
  datos?: T
  turnosProximos?: Cita[]
  esPrimeraVez?: boolean | null
}
```

---

## Flujo de Datos

```
1. Agente ve conversación pendiente
   ↓
2. Hace click "Ver Conversación"
   ↓
3. Se carga conversation-view.tsx
   ↓
4. PatientInfoPanel se monta
   ↓
5. usePatientData() llama a /api/support/patient
   ↓
6. API busca paciente por teléfono (buscarPaciente)
   ↓
7. Si existe: muestra datos + turnos próximos
   Si no existe: muestra "Paciente Nuevo 🆕"
   ↓
8. Agente tiene contexto completo para atender
```

---

## Seguridad

✅ **Verificación de autenticación** en el endpoint
✅ **Verificación de rol** (solo agentes de soporte)
✅ **Logging** de accesos para auditoría
✅ **Manejo seguro de errores** (no expone detalles internos)
✅ **CORS**: Compatible con iframe embedding futuro

---

## Caché y Performance

- **Caché local**: 2-3 minutos para evitar llamadas repetidas
- **Skeleton loaders**: Mejor UX durante la carga
- **Lazy loading**: Panel se carga mientras el agente ve la conversación
- **Botón refresh**: Agente puede actualizar datos manualmente si es necesario

---

## Próximos Pasos Sugeridos

1. Agregar búsqueda de paciente anterior (historial de conversaciones)
2. Permitir crear notas sobre el paciente en el panel
3. Mostrar historial de conversaciones anteriores del paciente
4. Integración con calendario de turnos (marcar como asistió/no asistió)
5. Alertas de datos sensibles (ej: alergia conocida)

---

## Testing

Para probar la funcionalidad:

1. Accede al panel de soporte: `/support`
2. Toma una conversación
3. El panel lateral debe mostrar datos del paciente
4. Si es paciente nuevo, verás el badge "Paciente Nuevo 🆕"
5. Haz click en "Próximos Turnos" para ver los turnos si existen
6. Haz click en el icono de refresh para actualizar los datos
