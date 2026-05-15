#!/usr/bin/env node

/**
 * Script de ejemplo para generar tokens SSO para testing
 * 
 * Uso:
 *   node generate-sso-token.js [cliente_id] [usuario_id] [nombre] [apellido] [expires_in_minutes]
 * 
 * Ejemplo:
 *   node generate-sso-token.js cliente_123 user_101 "Juan" "Pérez" 60
 * 
 * O con solo cliente_id (modo legacy):
 *   node generate-sso-token.js cliente_123
 */

const crypto = require('crypto');

// Debe coincidir con la variable de entorno del servidor
const TREELAN_BOT_SECRET = process.env.TREELAN_BOT_SECRET || "3x0nTh31sland";

// Configuración por defecto para testing
const DEFAULT_IP = "127.0.0.1";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Testing) SSO-Generator";

function generateSSOToken(options = {}) {
  const {
    clienteId = "test_cliente",
    usuarioId = null,
    nombre = null,
    apellido = null,
    email = "test@example.com",
    name = "Test User",
    expiresInMinutes = 60,
    ip = DEFAULT_IP,
    userAgent = DEFAULT_USER_AGENT,
  } = options;

  const now = Math.floor(Date.now() / 1000);
  const expirationTime = now + expiresInMinutes * 60;

  // 1. Crear el payload
  const payload = {
    cliente_id: clienteId,
    usuario_id: usuarioId,  // ID único del usuario dentro del cliente
    nombre: nombre,         // Nombre del usuario
    apellido: apellido,     // Apellido del usuario
    exp: expirationTime,
    iat: now,
    fingerprint: crypto
      .createHash('sha256')
      .update(`${ip}${userAgent}`)
      .digest('hex'),
    email,
    name,
  };

  // Limpiar campos nulos del payload
  Object.keys(payload).forEach(key => {
    if (payload[key] === null || payload[key] === undefined) {
      delete payload[key];
    }
  });

  // 2. Convertir payload a JSON y luego a base64
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson).toString('base64');

  // 3. Derivar el secreto (igual que en el servidor)
  const derivedSecret = crypto
    .createHash('sha256')
    .update(TREELAN_BOT_SECRET)
    .digest('hex');

  // 4. Crear firma HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', derivedSecret)
    .update(payloadB64)
    .digest('hex');

  // 5. Construir token final
  const ssoToken = `${payloadB64}.${signature}`;

  return {
    token: ssoToken,
    payload,
    url: `/support?sso_token=${ssoToken}`,
    expiresAt: new Date(expirationTime * 1000).toISOString(),
  };
}

// Si se ejecuta como script
if (require.main === module) {
  const args = process.argv.slice(2);
  
  const options = {
    clienteId: args[0] || "test_cliente",
    usuarioId: args[1] || null,
    nombre: args[2] || null,
    apellido: args[3] || null,
    expiresInMinutes: parseInt(args[4] || "60"),
  };

  const result = generateSSOToken(options);

  console.log("\n=== Token SSO Generado ===\n");
  console.log("Payload:");
  console.log(JSON.stringify(result.payload, null, 2));
  console.log("\nToken (Base64 + Firma):");
  console.log(result.token);
  console.log("\nURL Panel de Soporte:");
  console.log(`http://localhost:3000${result.url}`);
  console.log("\nURL Widget de Notificaciones Demo:");
  console.log(`http://localhost:3000/notification-widget-demo`);
  console.log("(Pega el token en la pagina de demo)");
  console.log("\nExpira en:");
  console.log(result.expiresAt);
  console.log("\n");
}

module.exports = { generateSSOToken };
