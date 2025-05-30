const crypto = require('crypto');

/**
 * Encrypt payload for Korapay API using AES-256-GCM
 * This is Korapay's official encryption method
 * @param {string} encryptionKey - The encryption key from Korapay
 * @param {object} payload - The payload to encrypt
 * @returns {string} - Encrypted data in format "iv:encrypted:authTag"
 */
const encryptKorapayPayload = (encryptionKey, payload) => {
    try {
        // Convert payload to JSON string
        const paymentData = JSON.stringify(payload);
        
        // Generate a random IV (Initialization Vector)
        const iv = crypto.randomBytes(16);
        
        // Create cipher using AES-256-GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
        
        // Encrypt the data
        const encrypted = cipher.update(paymentData);
        
        // Convert to hex strings
        const ivToHex = iv.toString('hex');
        const encryptedToHex = Buffer.concat([encrypted, cipher.final()]).toString('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        
        // Return in Korapay's expected format: "iv:encrypted:authTag"
        return `${ivToHex}:${encryptedToHex}:${authTag}`;
    } catch (error) {
        console.error('Korapay encryption error:', error);
        throw new Error('Failed to encrypt payload for Korapay');
    }
};

module.exports = encryptKorapayPayload;