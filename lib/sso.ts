import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getConfigByClienteId } from './db';

export interface SSOTokenPayload {
  cliente_id: string;
  usuario_id?: string;  // ID único del usuario dentro del cliente
  apellido?: string;    // Apellido del usuario
  nombre?: string;      // Nombre del usuario
  exp: number;
  iat: number;
  fingerprint: string;
  email?: string;
  name?: string;
}

export interface SSOValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: 'TOKEN_INVALID' | 'FORMAT_INVALID' | 'DECODE_FAILED' | 'TOKEN_INCOMPLETE' | 'TOKEN_EXPIRED' | 'FINGERPRINT_MISMATCH' | 'SIGNATURE_INVALID' | 'CLIENT_INVALID' | 'SERVER_ERROR';
  details?: {
    fingerprintReceived?: string;
    fingerprintCalculated?: string;
    clientIp?: string;
    userAgent?: string;
    expiredAt?: string;
    expiredAgoSeconds?: number;
    clienteId?: string;
  };
  payload?: SSOTokenPayload;
  // Configuración del cliente encontrada - contiene el configId (id interno) y displayName
  clientConfig?: {
    id: string;  // Este es el configId (nanoid) que se usa como tenantId en las sesiones
    displayName: string;
    cliente_id: string;
  };
}

/**
 * Decodifica y parsea el payload del token SSO
 */
function decodePayload(payloadBase64: string): SSOTokenPayload | null {
  try {
    const decoded = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

/**
 * Valida la firma HMAC-SHA256 del token
 * El secreto derivado es: sha256(TREELAN_BOT_SECRET + cliente_id)
 */
function verifySignature(
  payloadBase64: string,
  signature: string,
  secret: string,
  clienteId: string
): boolean {
  try {
    // Derivar secreto: sha256(TREELAN_BOT_SECRET + cliente_id)
    const derivedSecret = createHash('sha256')
      .update(secret + clienteId)
      .digest('hex');

    console.log('[SSO]   - Derivando secreto con: secret + cliente_id');
    console.log('[SSO]   - Cliente ID usado:', clienteId);
    console.log('[SSO]   - Secreto derivado (primeros 16 chars):', derivedSecret.substring(0, 16) + '...');

    const expectedSignature = createHmac('sha256', derivedSecret)
      .update(payloadBase64)
      .digest('hex');

    console.log('[SSO]   - Firma esperada:', expectedSignature);
    console.log('[SSO]   - Firma recibida:', signature);

    // Comparación timing-safe para evitar ataques de timing
    return timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    console.log('[SSO]   - Error en verificación de firma:', error);
    return false;
  }
}

/**
 * Valida el fingerprint del cliente
 */
function verifyFingerprint(
  clientFingerprint: string,
  clientIp: string,
  userAgent: string
): { valid: boolean; computed: string } {
  try {
    const computedFingerprint = createHash('sha256')
      .update(`${clientIp}${userAgent}`)
      .digest('hex');

    const valid = timingSafeEqual(
      Buffer.from(clientFingerprint),
      Buffer.from(computedFingerprint)
    );

    return { valid, computed: computedFingerprint };
  } catch (error) {
    return { valid: false, computed: 'error' };
  }
}

/**
 * Valida la expiración del token
 */
function isTokenExpired(expirationTime: number): boolean {
  return Date.now() > expirationTime * 1000;
}

/**
 * Obtiene la configuración del cliente y valida que exista y esté activo
 * Retorna la config con id, displayName y cliente_id si existe
 */
async function getClienteConfig(clienteId: string): Promise<{ id: string; displayName: string; cliente_id: string } | null> {
  try {
    const config = await getConfigByClienteId(clienteId);
    if (!config) return null;
    return {
      id: config.id,  // Este es el configId (nanoid) usado como tenantId
      displayName: config.displayName,
      cliente_id: config.cliente_id,
    };
  } catch (error) {
    console.error('[SSO] Error getting cliente config:', error);
    return null;
  }
}

/**
 * Valida completamente un token SSO
 */
export async function validateSSOToken(
  ssoToken: string,
  clientIp: string,
  userAgent: string
): Promise<SSOValidationResult> {
  console.log('[SSO] ========== INICIO VALIDACIÓN SSO ==========');
  console.log('[SSO] Client IP:', clientIp);
  console.log('[SSO] User-Agent:', userAgent);
  console.log('[SSO] Token recibido (primeros 50 chars):', ssoToken?.substring(0, 50) + '...');

  // Validar formato básico del token
  if (!ssoToken || typeof ssoToken !== 'string') {
    console.log('[SSO] FALLO: Token inválido o vacío');
    return { valid: false, error: 'Token inválido', errorCode: 'TOKEN_INVALID' };
  }

  const parts = ssoToken.split('.');
  if (parts.length !== 2) {
    console.log('[SSO] FALLO: Formato incorrecto. Se esperaban 2 partes, se recibieron:', parts.length);
    return { valid: false, error: 'Formato de token incorrecto', errorCode: 'FORMAT_INVALID' };
  }

  const [payloadBase64, signature] = parts;
  console.log('[SSO] Payload Base64 (primeros 50 chars):', payloadBase64.substring(0, 50) + '...');
  console.log('[SSO] Signature (primeros 30 chars):', signature.substring(0, 30) + '...');

  // Decodificar payload
  const payload = decodePayload(payloadBase64);
  if (!payload) {
    console.log('[SSO] FALLO: No se pudo decodificar el payload');
    return { valid: false, error: 'No se pudo decodificar el payload', errorCode: 'DECODE_FAILED' };
  }
  console.log('[SSO] Payload decodificado:', JSON.stringify(payload, null, 2));

  // Validar que tenga los campos requeridos
  if (!payload.cliente_id || !payload.exp || !payload.fingerprint) {
    console.log('[SSO] FALLO: Token incompleto. Campos faltantes:', {
      tiene_cliente_id: !!payload.cliente_id,
      tiene_exp: !!payload.exp,
      tiene_fingerprint: !!payload.fingerprint
    });
    return { valid: false, error: 'Token incompleto', errorCode: 'TOKEN_INCOMPLETE' };
  }

  // Validar expiración
  const now = Date.now();
  const expMs = payload.exp * 1000;
  console.log('[SSO] Verificando expiración:');
  console.log('[SSO]   - Token exp (unix):', payload.exp);
  console.log('[SSO]   - Token exp (date):', new Date(expMs).toISOString());
  console.log('[SSO]   - Ahora (unix ms):', now);
  console.log('[SSO]   - Ahora (date):', new Date(now).toISOString());
  console.log('[SSO]   - Diferencia (segundos):', (expMs - now) / 1000);
  
  if (isTokenExpired(payload.exp)) {
    const expiredAgoSeconds = (now - expMs) / 1000;
    console.log('[SSO] FALLO EXPIRACIÓN: Token expirado hace', expiredAgoSeconds, 'segundos');
    return { 
      valid: false, 
      error: 'Token expirado', 
      errorCode: 'TOKEN_EXPIRED',
      details: {
        expiredAt: new Date(expMs).toISOString(),
        expiredAgoSeconds: Math.round(expiredAgoSeconds)
      }
    };
  }
  console.log('[SSO] OK: Token no expirado');

  // Validar fingerprint
  console.log('[SSO] Verificando fingerprint:');
  console.log('[SSO]   - Fingerprint recibido:', payload.fingerprint);
  console.log('[SSO]   - IP para cálculo:', clientIp);
  console.log('[SSO]   - User-Agent para cálculo:', userAgent);
  
  const fingerprintResult = verifyFingerprint(payload.fingerprint, clientIp, userAgent);
  console.log('[SSO]   - Fingerprint calculado:', fingerprintResult.computed);
  console.log('[SSO]   - Coinciden:', fingerprintResult.valid);
  
  if (!fingerprintResult.valid) {
    console.log('[SSO] FALLO FINGERPRINT:');
    console.log('[SSO]   - Recibido:', payload.fingerprint);
    console.log('[SSO]   - Calculado:', fingerprintResult.computed);
    console.log('[SSO]   - Input usado: IP="' + clientIp + '" + UA="' + userAgent + '"');
    return { 
      valid: false, 
      error: 'Fingerprint no válido', 
      errorCode: 'FINGERPRINT_MISMATCH',
      details: {
        fingerprintReceived: payload.fingerprint,
        fingerprintCalculated: fingerprintResult.computed,
        clientIp: clientIp,
        userAgent: userAgent
      }
    };
  }
  console.log('[SSO] OK: Fingerprint válido');

  // Validar firma
  const secret = process.env.TREELAN_BOT_SECRET;
  if (!secret) {
    console.log('[SSO] FALLO: TREELAN_BOT_SECRET no está configurado');
    return { valid: false, error: 'Configuración de servidor incompleta', errorCode: 'SERVER_ERROR' };
  }
  console.log('[SSO] Verificando firma con secret (primeros 4 chars):', secret.substring(0, 4) + '***');

  if (!verifySignature(payloadBase64, signature, secret, payload.cliente_id)) {
    console.log('[SSO] FALLO FIRMA: La firma no coincide');
    console.log('[SSO]   - Signature recibida:', signature);
    return { valid: false, error: 'Firma de token no válida', errorCode: 'SIGNATURE_INVALID' };
  }
  console.log('[SSO] OK: Firma válida');

  // Validar que el cliente exista y esté activo
  console.log('[SSO] Verificando cliente_id:', payload.cliente_id);
  const clientConfig = await getClienteConfig(payload.cliente_id);
  if (!clientConfig) {
    console.log('[SSO] FALLO CLIENTE: Cliente no existe o está inactivo:', payload.cliente_id);
    return { 
      valid: false, 
      error: 'Cliente no existe o está inactivo', 
      errorCode: 'CLIENT_INVALID',
      details: {
        clienteId: payload.cliente_id
      }
    };
  }
  console.log('[SSO] OK: Cliente activo');
  console.log('[SSO]   - configId (tenantId):', clientConfig.id);
  console.log('[SSO]   - displayName:', clientConfig.displayName);

  console.log('[SSO] ========== VALIDACIÓN EXITOSA ==========');
  return { valid: true, payload, clientConfig };
}
