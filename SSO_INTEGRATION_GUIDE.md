# Guía de Integración: SSO para /support

## Para el Equipo de Desarrollo del Bot Treelan

Esta guía explica cómo integrar el sistema SSO de Chatbot v1-12 con el bot Treelan.

## 1. Endpoint de Validación SSO

**URL**: `/api/auth/sso`
**Método**: GET
**Parámetro**: `sso_token` (query string)

**Respuesta exitosa (302 Redirect)**:
```
Redirección a /support con sesión creada
```

**Respuesta error (401)**:
```json
{
  "error": "Firma de token no válida"
}
```

## 2. Generación del Token SSO en el Bot Treelan

### Información Necesaria

Para generar un token SSO válido, necesitas:

1. **cliente_id**: El ID del cliente configurado en el dashboard de Chatbot
   - Ejemplo: `"cliente_123"` (configurado en "Configuración General" → "Cliente ID")

2. **email**: Email del agente de soporte (opcional pero recomendado)
   - Ejemplo: `"agente@empresa.com"`

3. **name**: Nombre del agente (opcional pero recomendado)
   - Ejemplo: `"Juan Pérez"`

4. **IP del usuario**: La IP real del cliente que accederá al portal
   - Obtenida del request: `x-forwarded-for` o `x-real-ip`

5. **User-Agent**: El navegador del usuario
   - Obtenido del header: `User-Agent`

### Código de Ejemplo (Python)

```python
import json
import base64
import hashlib
import hmac
import time
import requests

def generate_sso_token(cliente_id, email, name, user_ip, user_agent):
    """
    Genera un token SSO para autenticar a un usuario en el portal de soporte
    
    Args:
        cliente_id: ID del cliente configurado en el dashboard
        email: Email del agente de soporte
        name: Nombre del agente de soporte
        user_ip: IP del usuario que accederá al portal
        user_agent: User-Agent del navegador del usuario
    
    Returns:
        Token SSO listo para usar en la URL
    """
    # IMPORTANTE: Esta constante debe coincidir exactamente
    TREELAN_BOT_SECRET = "3x0nTh31sland"
    
    # Timestamps
    now = int(time.time())
    expires_in = 3600  # Válido por 1 hora (recomendado: 5-60 minutos)
    
    # Crear fingerprint del cliente
    fingerprint = hashlib.sha256(
        f"{user_ip}{user_agent}".encode()
    ).hexdigest()
    
    # Crear payload
    payload = {
        "cliente_id": cliente_id,
        "exp": now + expires_in,
        "iat": now,
        "fingerprint": fingerprint,
        "email": email,
        "name": name,
    }
    
    # Convertir a JSON y luego a base64
    payload_json = json.dumps(payload, separators=(',', ':'))
    payload_b64 = base64.b64encode(payload_json.encode()).decode('ascii')
    
    # Derivar el secreto (IMPORTANTE: mismo proceso que en el servidor)
    derived_secret = hashlib.sha256(TREELAN_BOT_SECRET.encode()).hexdigest()
    
    # Firmar el payload
    signature = hmac.new(
        derived_secret.encode(),
        payload_b64.encode(),
        hashlib.sha256
    ).hexdigest()
    
    # Construir el token final
    sso_token = f"{payload_b64}.{signature}"
    
    return sso_token


def get_support_portal_url(base_url, sso_token):
    """Construye la URL completa del portal de soporte"""
    return f"{base_url}/support?sso_token={sso_token}"


# Ejemplo de uso
if __name__ == "__main__":
    # Datos del cliente
    cliente_id = "cliente_123"
    email = "agente@empresa.com"
    name = "Juan Pérez"
    
    # IP y User-Agent del usuario (obtenidos del request)
    user_ip = "192.168.1.100"
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    
    # Generar token
    token = generate_sso_token(cliente_id, email, name, user_ip, user_agent)
    
    # Construir URL
    base_url = "https://chatbot.example.com"  # Reemplazar con URL real
    support_url = get_support_portal_url(base_url, token)
    
    print(f"URL para redirigir: {support_url}")
    
    # En una aplicación web, redirigir al usuario a esta URL
    # return redirect(support_url)
```

### Código de Ejemplo (Node.js)

```javascript
const crypto = require('crypto');

function generateSSOToken(clienteId, email, name, userIp, userAgent) {
  // IMPORTANTE: Esta constante debe coincidir exactamente
  const TREELAN_BOT_SECRET = "3x0nTh31sland";
  
  // Timestamps
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600; // Válido por 1 hora
  
  // Crear fingerprint del cliente
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${userIp}${userAgent}`)
    .digest('hex');
  
  // Crear payload
  const payload = {
    cliente_id: clienteId,
    exp: now + expiresIn,
    iat: now,
    fingerprint,
    email,
    name,
  };
  
  // Convertir a JSON y luego a base64
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson).toString('base64');
  
  // Derivar el secreto (IMPORTANTE: mismo proceso que en el servidor)
  const derivedSecret = crypto
    .createHash('sha256')
    .update(TREELAN_BOT_SECRET)
    .digest('hex');
  
  // Firmar el payload
  const signature = crypto
    .createHmac('sha256', derivedSecret)
    .update(payloadB64)
    .digest('hex');
  
  // Construir el token final
  const ssoToken = `${payloadB64}.${signature}`;
  
  return ssoToken;
}

function getSupportPortalUrl(baseUrl, ssoToken) {
  return `${baseUrl}/support?sso_token=${ssoToken}`;
}

// Ejemplo de uso con Express
app.get('/generate-support-link', (req, res) => {
  const clienteId = req.query.cliente_id || "cliente_123";
  const email = req.user?.email || "agente@empresa.com";
  const name = req.user?.name || "Usuario";
  
  // IP del usuario realizando la solicitud
  const userIp = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('user-agent');
  
  // Generar token
  const token = generateSSOToken(clienteId, email, name, userIp, userAgent);
  
  // Construir URL
  const supportUrl = getSupportPortalUrl("https://chatbot.example.com", token);
  
  // Redirigir al usuario
  res.redirect(supportUrl);
});
```

## 3. Integración en Webhook del Bot

Si el bot Treelan maneja webhooks de eventos, puedes integrar SSO ahí:

```python
@app.route('/webhook/sso-link', methods=['POST'])
def generate_sso_link():
    """Endpoint que el bot Treelan puede llamar para generar un enlace SSO"""
    data = request.get_json()
    
    cliente_id = data.get('cliente_id')
    email = data.get('email')
    name = data.get('name')
    user_ip = data.get('user_ip')
    user_agent = data.get('user_agent')
    
    # Validar datos
    if not all([cliente_id, user_ip, user_agent]):
        return {'error': 'Datos incompletos'}, 400
    
    # Generar token
    token = generate_sso_token(
        cliente_id, 
        email or "agente@empresa.com",
        name or "Usuario",
        user_ip,
        user_agent
    )
    
    # Construir URL
    support_url = get_support_portal_url(
        "https://chatbot.example.com",
        token
    )
    
    return {
        'success': True,
        'support_url': support_url,
        'expires_in': 3600
    }
```

## 4. Obtener Datos del Usuario

### Desde un Request HTTP

```python
def get_user_info_from_request(request):
    """Extrae IP y User-Agent del request"""
    ip = (
        request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or
        request.headers.get('X-Real-IP') or
        request.remote_addr
    )
    user_agent = request.headers.get('User-Agent', '')
    
    return ip, user_agent
```

### Desde un Chat en WhatsApp

Si el usuario viene desde WhatsApp, necesitas obtener:
- **IP**: Usar servidor proxy/load balancer que la proporcione
- **User-Agent**: Usar un valor consistente o detectar del dispositivo

```python
# Opción 1: Valores por defecto para WhatsApp
ip = "unknown"  # Será el IP del usuario desde su navegador cuando haga clic
user_agent = "WhatsApp-Mobile"

# Opción 2: IP del servidor (menos seguro)
ip = socket.gethostbyname(socket.gethostname())
user_agent = "WhatsApp-Redirect"
```

## 5. Flujo Completo de Usuario

```
1. Usuario en WhatsApp escribe: "Quiero hablar con un agente"
   
2. Bot Treelan:
   ├─ Obtiene cliente_id del contexto
   ├─ Obtiene email/nombre del usuario
   ├─ Obtiene IP del usuario (si es posible)
   └─ Llama a tu función de generación de SSO token
   
3. Tu sistema:
   ├─ Genera token SSO
   ├─ Crea URL completa
   └─ Devuelve URL al bot
   
4. Bot Treelan:
   ├─ Envía al usuario un botón/enlace en WhatsApp
   └─ Texto: "Haz clic aquí para acceder al soporte"
   
5. Usuario:
   ├─ Hace clic en el enlace
   ├─ Abre /support?sso_token=TOKEN
   ├─ SSOHandler detecta el token
   └─ Se crea automáticamente una sesión
   
6. Portal de Soporte:
   ├─ Usuario ve la interfaz de soporte
   ├─ Puede chatear con agentes
   └─ No necesitó iniciar sesión manualmente
```

## 6. Testing

### Usando cURL

```bash
# Generar un token
TOKEN=$(node scripts/generate-sso-token.js cliente_123 agente@test.com "Test User" 60 | grep "Token (Base64" -A 1 | tail -1)

# Probar el endpoint (nota: cURL no seguirá redirects automáticamente)
curl -i "http://localhost:3000/api/auth/sso?sso_token=$TOKEN"

# Con navegador (seguirá automáticamente)
# Abre: http://localhost:3000/api/auth/sso?sso_token=TOKEN
```

### Usando Postman

1. Crear nueva request GET
2. URL: `http://localhost:3000/api/auth/sso`
3. Agregar parámetro query: `sso_token` = `TOKEN_GENERADO`
4. Headers → Seguir redirects (automático en Postman)
5. Enviar

## 7. Troubleshooting

### "Cliente no existe o está inactivo"
- ✅ Verificar que el `cliente_id` existe en el dashboard
- ✅ Verificar que la configuración está activa (no pausada)
- ✅ Usar el `Cliente ID` exacto de la configuración

### "Fingerprint no válido"
- ✅ Asegurar que se usa la IP real del usuario
- ✅ Asegurar que el User-Agent coincida exactamente
- ✅ No modificar el token después de generarlo

### "Firma de token no válida"
- ✅ Verificar que `TREELAN_BOT_SECRET = "3x0nTh31sland"` es exacto
- ✅ No modificar el payload después de generar el token
- ✅ Usar la misma derivación de secreto (SHA256)

### Token "expirado"
- ✅ Generar nuevos tokens (máximo 1 hora de validez)
- ✅ No reutilizar tokens viejos

## 8. Seguridad

### IMPORTANTE

- ⚠️ **Nunca expongas** `TREELAN_BOT_SECRET` en el cliente
- ⚠️ **Siempre genera** tokens en el backend/servidor
- ⚠️ **Usa HTTPS** para todas las comunicaciones
- ⚠️ **Valida IP y User-Agent** antes de generar token
- ⚠️ **Registra intentos fallidos** para detectar abuso

### Cambio de Secreto

Si necesitas cambiar `TREELAN_BOT_SECRET`:
1. Actualizar en variable de entorno del servidor
2. Informar al equipo Treelan
3. Todos los tokens generados con el secreto anterior dejarán de funcionar
4. Los usuarios necesitarán nuevos tokens

## 9. Soporte

Si tienes preguntas o problemas:

1. Ver `SSO_IMPLEMENTATION.md` en el repositorio
2. Ver `SSO_SUMMARY.md` para overview técnico
3. Ejecutar `node scripts/generate-sso-token.js --help`

---

**Última actualización**: 2026-05-13
