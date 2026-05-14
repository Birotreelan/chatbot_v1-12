import { NextRequest, NextResponse } from 'next/server';
import { validateSSOToken } from '@/lib/sso';
import { createSessionWithoutCookie } from '@/lib/auth';
import { nanoid } from 'nanoid';
import type { SessionData } from '@/lib/types';

export async function GET(request: NextRequest) {
  console.log('[SSO API] ========== NUEVA SOLICITUD SSO ==========');
  console.log('[SSO API] URL completa:', request.url);
  console.log('[SSO API] Headers relevantes:');
  console.log('[SSO API]   - x-forwarded-for:', request.headers.get('x-forwarded-for'));
  console.log('[SSO API]   - x-real-ip:', request.headers.get('x-real-ip'));
  console.log('[SSO API]   - user-agent:', request.headers.get('user-agent'));
  
  try {
    // Obtener el token SSO de los query parameters
    const ssoToken = request.nextUrl.searchParams.get('sso_token');
    console.log('[SSO API] Token recibido:', ssoToken ? 'SÍ (longitud: ' + ssoToken.length + ')' : 'NO');

    if (!ssoToken) {
      console.log('[SSO API] ERROR: Token no proporcionado');
      return NextResponse.json(
        { error: 'Token SSO requerido' },
        { status: 400 }
      );
    }

    // Obtener IP del cliente (considerar proxies)
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    console.log('[SSO API] IP del cliente determinada:', clientIp);

    // Obtener User-Agent
    const userAgent = request.headers.get('user-agent') || '';
    console.log('[SSO API] User-Agent:', userAgent);

    // Validar el token SSO
    console.log('[SSO API] Iniciando validación del token...');
    const validationResult = await validateSSOToken(ssoToken, clientIp, userAgent);
    console.log('[SSO API] Resultado validación:', validationResult.valid ? 'ÉXITO' : 'FALLO - ' + validationResult.error);

    if (!validationResult.valid || !validationResult.payload || !validationResult.clientConfig) {
      console.warn('[SSO API] Validación fallida:', validationResult.error);
      return NextResponse.json(
        { 
          error: validationResult.error || 'Token no válido',
          errorCode: validationResult.errorCode,
          details: validationResult.details
        },
        { status: 401 }
      );
    }

    const { cliente_id, email, name } = validationResult.payload;
    const { id: configId, displayName: configDisplayName } = validationResult.clientConfig;
    
    console.log('[SSO API] Datos extraídos del token:', { cliente_id, email, name });
    console.log('[SSO API] Datos de la configuración:', { configId, configDisplayName });

    // Crear sesión con los datos del token SSO
    // IMPORTANTE: usamos cliente_id como tenantId para ser consistente con el login tradicional
    // Los usuarios creados manualmente tienen tenantId = cliente_id, no configId
    const sessionData: SessionData = {
      userId: `sso_${cliente_id}_${nanoid(8)}`,
      username: email || `cliente_${cliente_id}`,
      role: 'support_agent',
      tenantId: cliente_id,  // Usar cliente_id para consistencia con login tradicional
      displayName: name || email || configDisplayName,  // Usar displayName de la config si no viene en el token
    };
    console.log('[SSO API] Creando sesión con datos:', sessionData);

    // Crear sesión en Redis (sin establecer cookie automáticamente)
    const sessionId = await createSessionWithoutCookie(sessionData);
    console.log('[SSO API] Sesión creada en Redis con ID:', sessionId);

    // Redirigir a /support pasando el sessionId por URL para evitar el bloqueo
    // de cookies de terceros en Safari cuando se usa dentro de un iframe.
    // El layout de /support leerá este parámetro server-side, establecerá la cookie
    // y redirigirá limpiando la URL.
    const redirectUrl = new URL('/support', request.url);
    redirectUrl.searchParams.set('_sid', sessionId);
    console.log('[SSO API] Redirigiendo a:', redirectUrl.toString());

    const response = NextResponse.redirect(redirectUrl, { status: 302 });
    return response;
  } catch (error) {
    console.error('[SSO API] Error crítico:', error);
    return NextResponse.json(
      { error: 'Error al procesar el token SSO' },
      { status: 500 }
    );
  }
}
