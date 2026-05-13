import { NextRequest, NextResponse } from 'next/server';
import { validateSSOToken } from '@/lib/sso';
import { createSession } from '@/lib/auth';
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

    if (!validationResult.valid || !validationResult.payload) {
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
    console.log('[SSO API] Datos extraídos del token:', { cliente_id, email, name });

    // Crear sesión con los datos del token SSO
    const sessionData: SessionData = {
      userId: `sso_${cliente_id}_${nanoid(8)}`,
      username: email || `cliente_${cliente_id}`,
      role: 'support_agent',
      tenantId: cliente_id,
      displayName: name || email || `Cliente ${cliente_id}`,
    };
    console.log('[SSO API] Creando sesión con datos:', sessionData);

    await createSession(sessionData);
    console.log('[SSO API] Sesión creada exitosamente');

    // Redirigir a /support sin el token en la URL
    const redirectUrl = new URL('/support', request.url);
    console.log('[SSO API] Redirigiendo a:', redirectUrl.toString());
    return NextResponse.redirect(redirectUrl, {
      status: 302,
    });
  } catch (error) {
    console.error('[SSO API] Error crítico:', error);
    return NextResponse.json(
      { error: 'Error al procesar el token SSO' },
      { status: 500 }
    );
  }
}
