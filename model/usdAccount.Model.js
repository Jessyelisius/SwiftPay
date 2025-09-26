// model/usdVirtualAccount.Model.js
const mongoose = require('mongoose');

const usdVirtualAccountSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    fincraAccountId: {
        type: String,
        required: true,
        unique: true
    },
    currency: {
        type: String,
        required: true,
        default: 'USD'
    },
    accountType: {
        type: String,
        required: true,
        default: 'individual'
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'approved', 'declined', 'issued', 'closed'],
        default: 'pending'
    },
    // Account details (populated when account is issued)
    accountNumber: {
        type: String,
        default: null
    },
    accountName: {
        type: String,
        default: null
    },
    bankName: {
        type: String,
        default: null
    },
    bankCode: {
        type: String,
        default: null
    },
    accountReference: {
        type: String,
        default: null
    },
    isActive: {
        type: Boolean,
        default: false
    },
    // Decline/Closure reasons
    declineReason: {
        type: String,
        default: null
    },
    closureReason: {
        type: String,
        default: null
    },
    // Request and response data for debugging
    requestData: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    responseData: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('UsdVirtualAccount', usdVirtualAccountSchema);