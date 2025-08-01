const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    currency: {
        type: String,
        required: true,
        // enum:['NGN', 'USD'],
        enum: ['NGN', 'USD', 'BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'],
        default: 'NGN'
    },
    method: { 
        type: String, 
        enum: ['card', 'virtual_account', 'bank_transfer', 'conversion', 'crypto_transfer'], 
        default: 'virtual_account' 
    },
    type: { 
        type: String, 
        enum: ['deposit', 'withdrawal', 'transfer', 'conversion', 'crypto_send', 'crypto_receive'], 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'success', 'failed', 'processing'], 
        default: 'pending' 
    },
    reference: { 
        type: String, 
        required: true, 
        unique: true 
    },
    korapayReference: { 
        type: String, 
        required: false,
        sparse: true // This allows multiple null values while maintaining uniqueness for non-null values
    },
    // For crypto transactions
    cryptoDetails: {
        fromCurrency: {
            type: String,
            enum: ['NGN', 'USD', 'BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC']
        },
        toCurrency: {
            type: String,
            enum: ['NGN', 'USD', 'BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC']
        },
        conversionRate: Number, // Rate used for conversion
        fromAmount: Number,     // Original amount
        toAmount: Number,       // Converted amount
        walletAddress: String,  // For external transfers
        txHash: String,         // Blockchain transaction hash
        network: String,        // Blockchain network used
        gasFee: Number         // Transaction fee (if applicable)
    },
    // this field for info about recipient transaction
    recipient: {
        type: {
            accountNumber: String,
            accountName: String,
            bankCode: String,
            bankName: String
        },
        required: false
    },      
    metadata: {
        type: mongoose.Schema.Types.Mixed, // For storing additional transaction data
        default: {}
    }
}, {
    timestamps: true 
});

// Add indexes for better query performance
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ status: 1 }); // Only if not defined in schema

module.exports = mongoose.model('Transaction', TransactionSchema);