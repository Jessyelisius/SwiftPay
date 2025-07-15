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
        default: 'NGN'
    },
    method: { 
        type: String, 
        enum: ['card', 'virtual_account', 'bank_transfer', 'conversion'], 
        default: 'virtual_account' 
    },
    type: { 
        type: String, 
        enum: ['deposit', 'withdrawal', 'transfer'], 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'success', 'failed'], 
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
    metadata: {
        type: mongoose.Schema.Types.Mixed, // For storing additional transaction data
        default: {}
    }
}, {
    timestamps: true 
});

// Add indexes for better query performance
// TransactionSchema.index({ userId: 1, createdAt: -1 });
// TransactionSchema.index({ reference: 1 });
// TransactionSchema.index({ korapayReference: 1 });
// TransactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);