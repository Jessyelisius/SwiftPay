const crypto = require('crypto');

function encryptKorapayPayload(encryptionKey, payload) {  
  const iv = crypto.randomBytes(16);

  // Ensure key is exactly 32 bytes for AES-256-GCM
  let key;
  if (typeof encryptionKey === 'string') {
    const keyBuffer = Buffer.from(encryptionKey, 'utf8');
    if (keyBuffer.length === 32) {
      key = keyBuffer;
    } else if (keyBuffer.length < 32) {
      key = Buffer.alloc(32);
      keyBuffer.copy(key);
    } else {
      key = keyBuffer.slice(0, 32);
    }
  } else {
    key = encryptionKey;
  }

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = cipher.update(JSON.stringify(payload));

  const ivToHex = iv.toString('hex');
  const encryptedToHex = Buffer.concat([encrypted, cipher.final()]).toString('hex');
  
  return `${ivToHex}:${encryptedToHex}:${cipher.getAuthTag().toString('hex')}`;
}

module.exports = encryptKorapayPayload;