const crypto = require('crypto');

function encryptKorapayPayload(encryptionKey, payload) {
  
  // Debug the key
  console.log('Encryption key:', encryptionKey);
  console.log('Key length:', encryptionKey?.length);
  console.log('Key type:', typeof encryptionKey);
  
  const iv = crypto.randomBytes(16);

  // KoraPay key is a 32-character string, convert to buffer as UTF-8
  const key = Buffer.from(encryptionKey, 'hex');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = cipher.update(JSON.stringify(payload));

  const ivToHex = iv.toString('hex');
  const encryptedToHex = Buffer.concat([encrypted, cipher.final()]).toString('hex');
  
  return `${ivToHex}:${encryptedToHex}:${cipher.getAuthTag().toString('hex')}`;
}


// function encryptKorapayPayload(encryptionKey, payload) {
  
//   // Debug the key
//   console.log('Encryption key:', encryptionKey);
//   console.log('Key length:', encryptionKey?.length);
//   console.log('Key type:', typeof encryptionKey);
  
//   // FIXED: IV should be 12 bytes for GCM mode, not 16
//   const iv = crypto.randomBytes(12);

//   // FIXED: Convert hex string to buffer (your key is hex, not UTF-8)
//   const key = Buffer.from(encryptionKey, 'hex');
  
//   // Validate key length
//   if (key.length !== 32) {
//     throw new Error(`Invalid key length. Expected 32 bytes, got ${key.length} bytes`);
//   }

//   const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
//   const encrypted = cipher.update(JSON.stringify(payload));

//   const ivToHex = iv.toString('hex');
//   const encryptedToHex = Buffer.concat([encrypted, cipher.final()]).toString('hex');
  
//   return `${ivToHex}:${encryptedToHex}:${cipher.getAuthTag().toString('hex')}`;
// }


module.exports = encryptKorapayPayload;