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

// console.log("encryption key", generateEncryptionKey());

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
        // const cipher = crypto.createCipher(ALGORITHM, keyBuffer);
        const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
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
        // const decipher = crypto.createDecipher(ALGORITHM, keyBuffer);
        const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
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
    } else if (type === 'usd_to_ngn' || type === 'coin_to_ngn' || type === 'ngn_to_usd') {
        fee = amt * 0.005;
    }else if (type === 'crypto_withdrawal') {
        fee = Math.min(1000, Math.max(200, amt * 0.01)); // 1% fee, min ₦200, max ₦1000
    } else if (type === 'crypto_conversion') {
        fee = amt * 0.003; // 0.3% fee for crypto-to-crypto
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

// Helper function to get fee based on type with minimum threshold
const getConversionFeeByType = (feeType, amount) => {
    const feePercentages = {
        usd_to_ngn: 1.5,
        ngn_to_usd: 2,
        coin_to_ngn: 2.5,
        crypto_conversion: 1
    };

    const minimumFees = {
        usd_to_ngn: 50,           // ₦50 minimum
        ngn_to_usd: 100,          // ₦100 minimum
        coin_to_ngn: 150,         // ₦150 minimum
        crypto_conversion: 50     // ₦50 minimum
    };

    const percentage = feePercentages[feeType] || 1.5;
    const minFee = minimumFees[feeType] || 50;

    const rawFee = (percentage / 100) * amount;
    const finalFee = Math.max(Math.ceil(rawFee), minFee);

    return finalFee;
};

//calculating the currency based on the currencies involved
const calculateConversionFee = (amount, fromCurrency, toCurrency) => {
    let feeType;

    //determine fee type base on conversion pair
    if(fromCurrency === 'USD' && toCurrency === 'NGN'){
        feeType = 'usd_to_ngn';
    }else if(fromCurrency === 'NGN' && toCurrency === 'USD'){
        feeType = 'ngn_to_usd';
    }else if(['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'].includes(fromCurrency) && toCurrency === 'NGN'){
        feeType = 'coin_to_ngn'; //based on coin->usd->ngn
    }else if(fromCurrency === 'NGN' && ['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'].includes(toCurrency)){
        feeType = 'ngn_to_usd'; //treat as NGN to Crypto
    }else if(['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'].includes(fromCurrency) &&
        ['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'].includes(toCurrency)){
        feeType = 'crypto_conversion' //crypto to crypto
    }else{
        feeType = 'usd_to_ngn'; // Default fallback
    }

     const fee = getConversionFeeByType(feeType, amount);

    return {
        fee,
        feeType
    };
};

//calculate crypto withdrawal fee(service fee + network fee)
const calculateWithdrawalFee = (amount, currency, network = null) => {
    //service fee using our function(treat as international transfer)
    const serviceFee = calculateTransactionFee('crypto_withdrawal', amount);

    //network fee (blockchain fees)
    const networkFees = {
        BTC: 0.0001,
        ETH: 0.002,
        LTC: 0.001,
        BNB: 0.0005,
        ADA: 1.0,
        XRP: 0.00001,
        USDT: 0.002, // ETH network default
        USDC: 0.002  // ETH network default
    }

     // Network multipliers for different chains
    const networkMultipliers = {
        'Ethereum': 1.0,
        'ERC20': 1.0,
        'BSC': 0.1,
        'BEP20': 0.1,
        'Tron': 0.05,
        'TRC20': 0.05,
        'Polygon': 0.01
    };

    const baseNetworkFee = networkFees[currency] || 0.001;
    const multipliers =networkMultipliers[network] || 1.0;
    const networkFee = baseNetworkFee * multipliers;

    return {
        serviceFee,
        networkFee,
        totalFee:serviceFee * networkFee,
        // totalFee: `totalFeeFiat: ${serviceFee}, totalFeeCrypto: ${networkFee}`,
        feeType: 'crypto_withdrawal'
    };
};

//get fee estimate before transaction
const getFeeEstimate = async(userId, type, amount, fromCurrency = null, toCurrency = null) => {
    try {
        let feeEstimate = {}
        
        if(type === 'conversion'){
            const conversionFee = calculateConversionFee(amount, fromCurrency, toCurrency)
            feeEstimate = {
                type: 'conversion',
                serviceFee: conversionFee.fee,
                feeType: conversionFee.feeType,
                totalFee: conversionFee.fee,
                feePercentage: (conversionFee.fee / amount * 100).toFixed(2)
            }
        }else if(type === 'crypto_withdrawal'){
            const withdrawalFee = calculateWithdrawalFee(amount, fromCurrency);
            feeEstimate = {
                type: 'crypto_withdrawal',
                serviceFee:withdrawalFee.serviceFee,
                networkFee:withdrawalFee.networkFee,
                totalFee:withdrawalFee.totalFee,
                feeType:withdrawalFee.feeType,
                feePercentage: (withdrawalFee.totalFee / amount * 100).toFixed(2)
            }
        }else{
            // Using existing fee calculation for other types
            const weeklyTransfers = await getWeeklyTransfers(userId);
            const fee = calculateTransactionFee(type, amount, weeklyTransfers);
            feeEstimate = {
                type: type,
                serviceFee: fee,
                totalFee: fee,
                feeType: type,
                feePercentage: (fee / amount * 100).toFixed(2),
                weeklyTransfersUsed: weeklyTransfers.length
            };
        }

        return feeEstimate;
    } catch (error) {
         console.error('Error calculating fee estimate:', error.message);
        throw new Error(`Failed to calculate fee estimate: ${error.message}`);
    }
};

//calculate total fee collected
const calculateRevenueFromFees = async(startDate, endDate) => {
    try {
        const revenue = await transactionModel.aggregate([
            {
                $match:{
                    status: 'success',
                    createdAt: {
                        $gte: new Date(startDate),
                        $lte: new Date(endDate)
                    },
                    $or: [
                        { 'metadata.conversionFee': { $exists: true, $gt: 0 } },
                        { 'cryptoDetails.serviceFee': { $exists: true, $gt: 0 } },
                        { 'metadata.serviceFee': { $exists: true, $gt: 0 } }
                    ]
                }
            },
            {
                $group:{
                    _id: null,
                    totalConversionFees: {
                        $sum: {
                            $ifNull: ['$metadata.conversionFee', 0]
                        }
                    },
                    totalServiceFees: {
                        $sum: {
                            $ifNull: ['$cryptoDetails.serviceFee', 0]
                        }
                    },
                     totalTransactions: { $sum: 1 },
                    feesByType: {
                        $push: {
                            type: '$metadata.feeType',
                            fee: {
                                $add: [
                                    { $ifNull: ['$metadata.conversionFee', 0] },
                                    { $ifNull: ['$cryptoDetails.serviceFee', 0] }
                                ]
                            }
                        }
                    }
                }
            }
        ]);
        if (revenue.length === 0) {
            return {
                totalRevenue: 0,
                totalConversionFees: 0,
                totalServiceFees: 0,
                totalTransactions: 0,
                period: { startDate, endDate }
            };
        }
        
        const result = revenue[0];
        return {
            totalRevenue: result.totalConversionFees + result.totalServiceFees,
            totalConversionFees: result.totalConversionFees,
            totalServiceFees: result.totalServiceFees,
            totalTransactions: result.totalTransactions,
            period: { startDate, endDate }
        };
    } catch (error) {
         console.error('Error calculating revenue:', error.message);
        throw new Error(`Failed to calculate revenue: ${error.message}`);
    }
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

//test code
// const testFeeCalculations = async () => {
//     try {
//         console.log('🧮 Testing Fee Calculations...\n');

//         // Test conversion fees
//         console.log('1. Conversion Fee Tests:');
//         const conversionTests = [
//             { amount: 100000, from: 'NGN', to: 'USD' },
//             { amount: 100, from: 'USD', to: 'NGN' },
//             { amount: 50000, from: 'NGN', to: 'BTC' },
//             { amount: 1, from: 'BTC', to: 'USDT' }
//         ];

//         conversionTests.forEach(test => {
//             const result = calculateConversionFee(test.amount, test.from, test.to);
//             console.log(`   ${test.amount} ${test.from} → ${test.to}: ₦${result.fee} (${result.feeType})`);
//         });

//         // Test withdrawal fees
//         console.log('\n2. Withdrawal Fee Tests:');
//         const withdrawalTests = [
//             { amount: 0.01, currency: 'BTC', network: 'Bitcoin' },
//             { amount: 0.5, currency: 'ETH', network: 'Ethereum' },
//             { amount: 100, currency: 'USDT', network: 'TRC20' },
//             { amount: 1000, currency: 'USDC', network: 'BSC' }
//         ];

//         withdrawalTests.forEach(test => {
//             const result = calculateWithdrawalFee(test.amount, test.currency, test.network);
//             console.log(`   ${test.amount} ${test.currency} (${test.network}):`);
//             console.log(`     Service Fee: ₦${result.serviceFee}`);
//             console.log(`     Network Fee: ${result.networkFee} ${test.currency}`);
//         });

//         // Test fee estimates
//         console.log('\n3. Fee Estimate Tests:');
//         const testUserId = '64f7b1234567890123456789';
        
//         try {
//             const conversionEstimate = await getFeeEstimate(testUserId, 'conversion', 100000, 'NGN', 'USD');
//             console.log('   Conversion Estimate:', conversionEstimate);

//             const withdrawalEstimate = await getFeeEstimate(testUserId, 'crypto_withdrawal', 0.01, 'BTC');
//             console.log('   Withdrawal Estimate:', withdrawalEstimate);
//         } catch (error) {
//             console.log('   Fee estimate tests skipped:', error.message);
//         }

//         console.log('\n✅ Fee calculation tests completed!');

//     } catch (error) {
//         console.error('❌ Fee calculation tests failed:', error.message);
//     }
// };

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
    getWeeklyTransfers,
    calculateTransactionFee,
    calculateWithdrawalFee,
    calculateConversionFee,
    getFeeEstimate,
    calculateRevenueFromFees,
    // testFeeCalculations
};

// testFeeCalculations();




