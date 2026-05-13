#!/usr/bin/env node

/**
 * Script de ejemplo para generar tokens SSO para testing
 * 
 * Uso:
 *   node generate-sso-token.js [cliente_id] [email] [name] [expires_in_minutes]
 * 
 * Ejemplo:
 *   node generate-sso-token.js cliente_123 agente@empresa.com "Juan Pérez" 60
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
    exp: expirationTime,
    iat: now,
    fingerprint: crypto
      .createHash('sha256')
      .update(`${ip}${userAgent}`)
      .digest('hex'),
    email,
    name,
  };

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
    email: args[1] || "test@example.com",
    name: args[2] || "Test User",
    expiresInMinutes: parseInt(args[3] || "60"),
  };

  const result = generateSSOToken(options);

  console.log("\n=== Token SSO Generado ===\n");
  console.log("Payload:");
  console.log(JSON.stringify(result.payload, null, 2));
  console.log("\nToken (Base64 + Firma):");
  console.log(result.token);
  console.log("\nURL completa:");
  console.log(`http://localhost:3000${result.url}`);
  console.log("\nExpira en:");
  console.log(result.expiresAt);
  console.log("\n");
}

module.exports = { generateSSOToken };
