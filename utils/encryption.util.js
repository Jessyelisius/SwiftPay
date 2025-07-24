const crypto = require('crypto');

function encryptKorapayPayload(encryptionKey, payload) {  
  const iv = crypto.randomBytes(16);

  // KoraPay key is a 32-character string, convert to buffer as UTF-8
  const key = Buffer.from(encryptionKey, 'utf8');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = cipher.update(JSON.stringify(payload));

  const ivToHex = iv.toString('hex');
  const encryptedToHex = Buffer.concat([encrypted, cipher.final()]).toString('hex');
  
  return `${ivToHex}:${encryptedToHex}:${cipher.getAuthTag().toString('hex')}`;
}

module.exports = encryptKorapayPayload;