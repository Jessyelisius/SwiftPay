// Fixed Wallet Schema
const mongoose = require('mongoose')

const WalletSchema = new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true, 
        unique: true
    },
    balance:{
       NGN: {
            type: Number,
            default: 0,
            min: [0, "Balance cannot be negative"]
        },
        USD: {
            type: Number,
            default: 0,
            min: [0, "Balance cannot be negative"]
        }
    },
    currency:{
        type:String,
        enum:['NGN', 'USD'],
        default: 'NGN'
    },
    // Crypto balances (for internal tracking only)
    cryptoBalances: {
        BTC: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        ETH: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        LTC: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        BNB: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        ADA: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        XRP: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        USDT: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        },
        USDC: {
            type: Number,
            default: 0,
            min: [0, "Crypto balance cannot be negative"]
        }
    },
    userSavedCard:[{
        number: {
            type: String,
            required: true
        },
        expiry_month: {
            type: String,
            required: true
        },
        expiry_year: {
            type: String,
            required: true
        },
        authorization: {
            type: Object,
            required: true
        },
        addedAt:{
            type: Date,
            default: Date.now
        }
    }],
    hasVirtualAccount:{
        type:Boolean,
    },
    virtualAccount:{
        type: Object,
    },
    // External wallet addresses for crypto withdrawals and
    externalWallets: [{
        currency: {
            type: String,
            enum: ['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'],
            required: true
        },
        address: {
            type: String,
            required: true
        },
        label: {
            type: String, // User-friendly name like "My Trust Wallet"
            required: true
        },
        network: {
            type: String, // e.g., "ERC20", "BEP20", "TRC20" for tokens
            required: false
        },
        addedAt: {
            type: Date,
            default: Date.now
        },
        isVerified: {
            type: Boolean,
            default: false
        }
    }],
    lastTransaction:{
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Transaction' 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
}, {timestamps:true})

module.exports = mongoose.model('Wallet', WalletSchema);