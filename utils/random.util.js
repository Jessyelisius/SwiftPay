const crypto = require('crypto');
const transactionModel = require('../model/transactionModel');

// Configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits

/**
 * Generate a random encryption key
 * Store this securely in your environment variables
 */
function generateEncryptionKey() {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Encrypt sensitive data
 * @param {string} text - The text to encrypt
 * @param {string} key - The encryption key (hex string)
 * @returns {string} - Encrypted data with IV and tag (base64)
 */
function encryptData(text, key) {
    try {
        if (!text || !key) {
            throw new Error('Text and key are required');
        }

        // Convert hex key to buffer
        const keyBuffer = Buffer.from(key, 'hex');
        
        // Generate random IV
        const iv = crypto.randomBytes(IV_LENGTH);
        
        // Create cipher
        const cipher = crypto.createCipher(ALGORITHM, keyBuffer);
        cipher.setAAD(Buffer.from('kyc-data')); // Additional authenticated data
        
        // Encrypt the text
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // Get the authentication tag
        const tag = cipher.getAuthTag();
        
        // Combine IV + tag + encrypted data
        const combined = Buffer.concat([iv, tag, Buffer.from(encrypted, 'hex')]);
        
        return combined.toString('base64');
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt data');
    }
}

/**
 * Decrypt sensitive data
 * @param {string} encryptedData - The encrypted data (base64)
 * @param {string} key - The encryption key (hex string)
 * @returns {string} - Decrypted text
 */
function decryptData(encryptedData, key) {
    try {
        if (!encryptedData || !key) {
            throw new Error('Encrypted data and key are required');
        }

        // Convert hex key to buffer
        const keyBuffer = Buffer.from(key, 'hex');
        
        // Convert base64 to buffer
        const combined = Buffer.from(encryptedData, 'base64');
        
        // Extract IV, tag, and encrypted data
        const iv = combined.slice(0, IV_LENGTH);
        const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
        
        // Create decipher
        const decipher = crypto.createDecipher(ALGORITHM, keyBuffer);
        decipher.setAAD(Buffer.from('kyc-data')); // Same AAD as encryption
        decipher.setAuthTag(tag);
        
        // Decrypt the data
        let decrypted = decipher.update(encrypted, null, 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt data');
    }
}

/**
 * Encrypt KYC sensitive fields
 * @param {Object} kycData - KYC data object
 * @param {string} key - Encryption key
 * @returns {Object} - KYC data with encrypted sensitive fields
 */
function encryptKYCData(kycData, key) {
    try {
        const sensitiveFields = ['idNumber', 'nin', 'bvn', 'phone'];
        const encryptedData = { ...kycData };
        
        sensitiveFields.forEach(field => {
            if (encryptedData[field]) {
                encryptedData[field] = encryptData(encryptedData[field].toString(), key);
            }
        });
        
        return encryptedData;
    } catch (error) {
        console.error('KYC encryption error:', error);
        throw new Error('Failed to encrypt KYC data');
    }
}

/**
 * Decrypt KYC sensitive fields
 * @param {Object} encryptedKycData - Encrypted KYC data object
 * @param {string} key - Encryption key
 * @returns {Object} - KYC data with decrypted sensitive fields
 */
function decryptKYCData(encryptedKycData, key) {
    try {
        const sensitiveFields = ['idNumber', 'nin', 'bvn', 'phone'];
        const decryptedData = { ...encryptedKycData };
        
        sensitiveFields.forEach(field => {
            if (decryptedData[field]) {
                decryptedData[field] = decryptData(decryptedData[field], key);
            }
        });
        
        return decryptedData;
    } catch (error) {
        console.error('KYC decryption error:', error);
        throw new Error('Failed to decrypt KYC data');
    }
}

/**
 * Hash sensitive data for comparison (one-way)
 * @param {string} data - Data to hash
 * @param {string} salt - Salt for hashing
 * @returns {string} - Hashed data
 */
function hashData(data, salt) {
    try {
        if (!data || !salt) {
            throw new Error('Data and salt are required');
        }
        
        return crypto.pbkdf2Sync(data, salt, 100000, 64, 'sha256').toString('hex');
    } catch (error) {
        console.error('Hashing error:', error);
        throw new Error('Failed to hash data');
    }
}

/**
 * Generate a salt for hashing
 * @returns {string} - Random salt
 */
function generateSalt() {
    return crypto.randomBytes(32).toString('hex');
}

// 🔐 Generate unique transaction ID (e.g. SWFT-LE2D1J-4K9TZ)

const generateId = (prefix = 'SP', type = '') => {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(4).toString('hex').toUpperCase();

  const typeMap = {
    depositwithcard: 'DEP',
    bank_transfer: 'TRF',
    usd_to_ngn: 'CNV',
    coin_to_ngn: 'COIN',
    virtual_account: 'VBA'
  };

  const typePrefix = typeMap[(type || '').toLowerCase()] || 'TXN';

  return `${prefix}-${typePrefix}-${timestamp}-${randomBytes}`;
};

// Simple fee calculation function (your preferred approach)
const calculateTransactionFee = (type, amount, existingWeeklyTransfers = []) => {
    let fee = 0;
    type = (type || '').toLowerCase();
    const amt = Number(amount);
    
    if (type === 'bank_transfer') {
        const totalWeeklyTransfers = existingWeeklyTransfers.reduce((sum, tx) => sum + tx.amount, 0);
        if (amt <= 50000 && existingWeeklyTransfers.length < 3 && totalWeeklyTransfers <= 150000) {
            fee = 0; // Free transfer
        } else if (amt <= 50000) {
            fee = 10; // Minimal fee after 3 free ones
        } else if (amt > 50000 && amt <= 200000) {
            fee = 25 + (amt * 0.001);
        } else {
            fee = 50 + (amt * 0.0015);
        }
    } else if (type === 'instant_transfer') {
        fee = amt <= 50000 ? 25 : Math.min(100, amt * 0.002);
    } else if (type === 'international_transfer') {
        fee = Math.min(2000, Math.max(500, amt * 0.015));
    } else if (type === 'depositwithcard') {
        fee = Math.min(2500, Math.max(100, amt * 0.014));
    } else if (type === 'virtual_account') {
        fee = amt <= 10000 ? 0 : 10;
    } else if (type === 'usd_to_ngn' || type === 'coin_to_ngn') {
        fee = amt * 0.005;
    }
    
    return Math.ceil(fee);
};

// Helper to get user's weekly transfers (simplified)
const getWeeklyTransfers = async (userId) => {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    return await transactionModel.find({
        userId: userId,
        type: 'transfer',
        status: { $in: ['success', 'pending'] },
        createdAt: { $gte: startOfWeek }
    });
};

function ErrorDisplay(error) {
  console.error(error); // Log for debugging, you can remove in production

  if (error.name === "MongoServerError" && error.code === 11000) {
    return {
      msg: "Oops! It seems like the details you provided already exist in our system. Please try again.",
    };
  }

  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map((err) => err.message);
    return {
      msg: messages.length
        ? messages[0]
        : "Invalid data. Please check your input.",
    };
  }

  if (error.message) {
    return { msg: error.message };
  }

  return { msg: "An unexpected error occurred. Please try again later." };
}

// Export functions
module.exports = {
    generateEncryptionKey,
    encryptData,
    decryptData,
    encryptKYCData,
    decryptKYCData,
    hashData,
    generateSalt,
    ErrorDisplay,
    generateId,
    calculateTransactionFee,
    getWeeklyTransfers
};

// Example usage:
/*
// 1. Generate encryption key (do this once and store in .env)
const encryptionKey = generateEncryptionKey();
console.log('Store this key in your .env file:');
console.log('KYC_ENCRYPTION_KEY=' + encryptionKey);

// 2. Encrypt KYC data
const kycData = {
    idNumber: '12345678901',
    idType: 'nin',
    phone: '09061591601'
};

const encrypted = encryptKYCData(kycData, encryptionKey);
console.log('Encrypted KYC data:', encrypted);

// 3. Decrypt KYC data
const decrypted = decryptKYCData(encrypted, encryptionKey);
console.log('Decrypted KYC data:', decrypted);
*/




