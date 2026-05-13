# Implementación de Autologin SSO para /support

## Descripción General

Se ha implementado un sistema de autenticación SSO (Single Sign-On) que permite a sistemas externos autenticar usuarios en el módulo de soporte sin necesidad de credenciales. El sistema genera un token firmado que es validado por el servidor antes de crear una sesión.

## Flujo de Autenticación SSO

```
Sistema Externo → Genera Token SSO → Usuario accede a /support?sso_token=TOKEN
                                              ↓
                                   SSOHandler detecta el token
                                              ↓
                                   Redirige a /api/auth/sso?sso_token=TOKEN
                                              ↓
                                   API valida token (firma, expiración, fingerprint)
                                              ↓
                                   Si es válido: crea sesión + redirige a /support
                                   Si es inválido: retorna error 401
```

## Componentes Implementados

### 1. `lib/sso.ts` - Librería de Validación SSO
Módulo que contiene todas las funciones de validación del token SSO:

- **`validateSSOToken(ssoToken, clientIp, userAgent)`**: Función principal que valida completamente el token
  - Verifica el formato del token
  - Decodifica el payload
  - Valida expiración
  - Verifica fingerprint del cliente
  - Valida firma HMAC-SHA256
  - Verifica que el cliente exista y esté activo

- Funciones auxiliares:
  - `decodePayload(payloadBase64)`: Decodifica el payload en base64
  - `verifySignature()`: Valida la firma HMAC-SHA256
  - `verifyFingerprint()`: Verifica que el fingerprint coincida
  - `isTokenExpired()`: Valida la expiración del token
  - `isClienteActive()`: Verifica que el cliente exista en la BD

### 2. `app/api/auth/sso/route.ts` - Endpoint de Validación SSO
API Route que procesa los tokens SSO:

- **Método**: GET
- **Parámetros**: `sso_token` (query param)
- **Respuestas**:
  - `302 Redirect a /support`: Si el token es válido
  - `401 JSON error`: Si el token es inválido
  - `400 JSON error`: Si falta el token
  - `500 JSON error`: Error del servidor

### 3. `components/support/sso-handler.tsx` - Componente Cliente
Componente React que maneja el SSO en el lado del cliente:

- Detecta si hay un `sso_token` en la URL
- Muestra un loader mientras se procesa el token
- Redirige al endpoint de SSO para la validación

### 4. `app/support/layout.tsx` - Layout Modificado
Se ha modificado el layout de soporte para incluir:

- Import del componente `SSOHandler`
- Renderizado del SSOHandler antes de verificar la sesión normal
- Así se permite tanto login tradicional como SSO

## Formato del Token SSO

El token tiene el formato: `BASE64_PAYLOAD.HMAC_SIGNATURE`

### Estructura del Payload (JSON)
```json
{
  "cliente_id": "identificador_del_cliente",
  "exp": 1234567890,
  "iat": 1234567800,
  "fingerprint": "sha256_hash_de_ip_y_user_agent",
  "email": "usuario@example.com",
  "name": "Nombre del Usuario"
}
```

**Campos obligatorios:**
- `cliente_id`: ID del cliente configurado en el dashboard
- `exp`: Timestamp Unix de expiración (segundos)
- `iat`: Timestamp Unix de emisión (segundos)
- `fingerprint`: SHA256 de `IP + User-Agent`

**Campos opcionales:**
- `email`: Email del usuario
- `name`: Nombre del usuario

### Generación del Token (Pseudocódigo)

```python
import json
import base64
import hashlib
import hmac
import time

TREELAN_BOT_SECRET = "3x0nTh31sland"  # Variable de entorno

# 1. Crear el payload
payload = {
    "cliente_id": "cliente_123",
    "exp": int(time.time()) + 3600,  # Válido por 1 hora
    "iat": int(time.time()),
    "fingerprint": hashlib.sha256(f"{user_ip}{user_agent}".encode()).hexdigest(),
    "email": "agente@empresa.com",
    "name": "Juan Pérez"
}

# 2. Convertir payload a JSON y luego a base64
payload_json = json.dumps(payload, separators=(',', ':'))
payload_b64 = base64.b64encode(payload_json.encode()).decode()

# 3. Derivar el secreto
derived_secret = hashlib.sha256(TREELAN_BOT_SECRET.encode()).hexdigest()

# 4. Crear firma HMAC-SHA256
signature = hmac.new(
    derived_secret.encode(),
    payload_b64.encode(),
    hashlib.sha256
).hexdigest()

# 5. Construir token final
sso_token = f"{payload_b64}.{signature}"

# 6. URL de redirección
redirect_url = f"https://dominio.com/support?sso_token={sso_token}"
```

## Variables de Entorno Requeridas

```env
TREELAN_BOT_SECRET=3x0nTh31sland
```

Esta variable es fundamental para:
- Derivar la clave de validación de firma HMAC
- Debe ser exactamente igual en el sistema generador de tokens y en este servidor

## Seguridad

### Medidas Implementadas

1. **Firma HMAC-SHA256**: Token firmado con clave derivada de `TREELAN_BOT_SECRET`
2. **Fingerprint del Cliente**: Validación de `IP + User-Agent` para evitar reutilización de tokens
3. **Comparación Timing-Safe**: Uso de `timingSafeEqual` para evitar ataques de timing
4. **Expiración**: Tokens válidos solo por un período limitado (generalmente 1 hora)
5. **Validación de Cliente**: Verifica que el `cliente_id` exista y esté activo
6. **HTTP-only Cookies**: Las sesiones se almacenan en cookies httpOnly
7. **Redis**: Sesiones almacenadas en Redis con expiración automática

### Recomendaciones

- Mantener `TREELAN_BOT_SECRET` confidencial y cambiarla regularmente
- Generar tokens con expiración corta (recomendado: 5-60 minutos)
- Validar el User-Agent y IP en el servidor generador para que coincidan
- Usar HTTPS siempre (requerido para cookies seguras)
- Registrar intentos de autenticación fallidos para detectar abuso

## Compatibilidad con Login Tradicional

El sistema SSO **no reemplaza** el login tradicional. Ambos métodos coexisten:

- **Login Tradicional**: `POST /api/login` con usuario y contraseña
- **SSO**: `GET /api/auth/sso?sso_token=TOKEN`

Los usuarios pueden usar cualquiera de los dos métodos según sea necesario.

## Testing

### Generar un Token de Prueba

```javascript
// Node.js
const crypto = require('crypto');

const TREELAN_BOT_SECRET = "3x0nTh31sland";
const clienteId = "test_cliente";
const userIp = "127.0.0.1";
const userAgent = "Test Browser";
const now = Math.floor(Date.now() / 1000);

const payload = {
  cliente_id: clienteId,
  exp: now + 3600,
  iat: now,
  fingerprint: crypto
    .createHash('sha256')
    .update(`${userIp}${userAgent}`)
    .digest('hex'),
  email: "test@example.com",
  name: "Test User"
};

const payloadB64 = Buffer.from(JSON.stringify(payload, null, 0)).toString('base64');

const derivedSecret = crypto
  .createHash('sha256')
  .update(TREELAN_BOT_SECRET)
  .digest('hex');

const signature = crypto
  .createHmac('sha256', derivedSecret)
  .update(payloadB64)
  .digest('hex');

const token = `${payloadB64}.${signature}`;
console.log(`Token: ${token}`);
console.log(`URL: /support?sso_token=${token}`);
```

### Verificar Directamente

```bash
# Sin token (debe fallar con 400)
curl http://localhost:3000/api/auth/sso

# Con token inválido
curl http://localhost:3000/api/auth/sso?sso_token=invalid_token
```

## Troubleshooting

### "Token SSO requerido"
- El parámetro `sso_token` no fue proporcionado en la URL

### "Formato de token incorrecto"
- El token no tiene el formato `PAYLOAD.SIGNATURE`
- Verificar que el payload esté codificado correctamente en base64

### "No se pudo decodificar el payload"
- El payload base64 es inválido
- El JSON dentro del payload es malformado

### "Token incompleto"
- Faltan campos obligatorios: `cliente_id`, `exp`, o `fingerprint`

### "Token expirado"
- El `exp` del token es menor que el timestamp actual
- Generar un nuevo token con expiración futura

### "Fingerprint no válido"
- La IP o User-Agent no coinciden
- Generar token con la IP y User-Agent correctos

### "Firma de token no válida"
- `TREELAN_BOT_SECRET` es diferente entre sistemas
- El payload fue modificado después de la firma
- Verificar que la derivación del secreto sea idéntica

### "Cliente no existe o está inactivo"
- El `cliente_id` no existe en la base de datos
- El cliente está marcado como inactivo
- Verificar en el dashboard que la configuración exista

## Logs

El sistema registra en console:
- Intentos de validación fallidos con el motivo
- Errores de conexión a la base de datos
- Solicitudes de creación de sesión

Para debugging, buscar logs con el prefijo `[SSO]` en los logs del servidor.
