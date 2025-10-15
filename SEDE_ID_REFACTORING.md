# Refactorización de Sede_Id

## Resumen de Cambios

Se ha refactorizado el sistema para que el `Sede_Id` se tome desde cada request entrante en lugar de la configuración almacenada en el panel de control.

## Cambios Realizados

### 1. **app/api/proxylistener/route.ts**
- ✅ Extrae `Sede_Id` del body del request
- ✅ Incluye `Sede_Id` en el mensaje de notificación a OpenAI
- ✅ Logs detallados del `Sede_Id` recibido

### 2. **app/api/chat/route.ts**
- ✅ Acepta `sede_id` como parámetro opcional en el body
- ✅ Usa `sede_id` del request si está disponible, sino usa el del config (fallback)
- ✅ Pasa el `sede_id` efectivo a `processWebChatMessage`

### 3. **lib/web-chat-final.ts**
- ✅ Actualizada la función `processWebChatMessage` para aceptar `sedeId` opcional
- ✅ Usa `sedeId` del parámetro si está disponible, sino usa el del config (fallback)
- ✅ Pasa el `sede_id` efectivo a `createSystemBlock`

## Comportamiento

### Prioridad de Sede_Id
1. **Primera prioridad**: `Sede_Id` del request entrante
2. **Fallback**: `sede_id` de la configuración almacenada

### Flujo de Datos

#### Para requests desde ProxyListener:
\`\`\`
Request → Sede_Id extraído → Incluido en notificación a OpenAI
\`\`\`

#### Para requests desde Web Chat:
\`\`\`
Request → sede_id extraído → processWebChatMessage → createSystemBlock → obtenerDatosSede
\`\`\`

## Compatibilidad

- ✅ **Retrocompatible**: Si no se envía `Sede_Id` en el request, se usa el del config
- ✅ **Flexible**: Permite diferentes sedes para el mismo cliente según el origen del request
- ✅ **Sin cambios en DB**: El campo `sede_id` permanece en la configuración como fallback

## Ejemplo de Request

\`\`\`json
{
  "Cliente_Id": "a9454478-89c1-11e3-a751-081012379997",
  "Phone_Number_Id": "383559004834703",
  "Phone": "5493413121395",
  "Type": "template",
  "Body": "{...}",
  "Chatbot_Data": "{...}",
  "Sede_Id": "cfe6a025-1b9d-102d-b564-6096d05021b3"
}
\`\`\`

## Testing

Para probar la funcionalidad:

1. **Con Sede_Id en request**: Enviar request con `Sede_Id` y verificar que se use ese valor
2. **Sin Sede_Id en request**: Enviar request sin `Sede_Id` y verificar que se use el del config
3. **Logs**: Revisar logs para confirmar qué `Sede_Id` se está usando en cada caso

## Notas Importantes

- El campo `sede_id` en la configuración del panel de control sigue siendo útil como valor por defecto
- Los logs indican claramente si el `Sede_Id` viene del request o del config
- No se requieren cambios en la base de datos ni en el schema
