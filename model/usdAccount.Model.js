// model/usdVirtualAccount.Model.js
const mongoose = require('mongoose');

const usdVirtualAccountSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true // Each user can have only one USD virtual account
    },
    fincraAccountId: {
        type: String,
        required: true,
        unique: true // Unique identifier from Fincra
    },
    currency: {
        type: String,
        required: true,
        default: 'USD',
        enum: ['USD']
    },
    accountType: {
        type: String,
        required: true,
        default: 'individual',
        enum: ['individual'] // Fincra only supports individual accounts for USD
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
    
    // Status flags
    isActive: {
        type: Boolean,
        default: false
    },
    isPermanent: {
        type: Boolean,
        default: true // Fincra USD accounts are permanent
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
    
    // Monthly limits and restrictions
    monthlyLimit: {
        type: Number,
        default: 10000 // $10,000 USD monthly limit as per Fincra
    },
    supportedTransactions: {
        type: [String],
        default: ['ACH'] // Only ACH transactions supported
    },
    
    // Risk assessment
    riskRating: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: null
    },
    
    // Metadata for additional information
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    approvedAt: {
        type: Date,
        default: null
    },
    issuedAt: {
        type: Date,
        default: null
    },
    closedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true, // Automatically manage createdAt and updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
usdVirtualAccountSchema.index({ userId: 1 });
usdVirtualAccountSchema.index({ fincraAccountId: 1 });
usdVirtualAccountSchema.index({ status: 1 });
usdVirtualAccountSchema.index({ createdAt: -1 });

// Virtual for account display name
usdVirtualAccountSchema.virtual('displayName').get(function() {
    return this.accountName || `USD Account - ${this.status}`;
});

// Virtual to check if account is ready for use
usdVirtualAccountSchema.virtual('isReady').get(function() {
    return this.status === 'issued' && this.isActive && this.accountNumber;
});

// Virtual to get formatted account info
usdVirtualAccountSchema.virtual('accountInfo').get(function() {
    if (!this.isReady) {
        return {
            status: this.status,
            message: this.status === 'pending' ? 'Account is being processed' : 
                    this.status === 'declined' ? `Account was declined: ${this.declineReason}` :
                    'Account not ready'
        };
    }
    
    return {
        accountNumber: this.accountNumber,
        accountName: this.accountName,
        bankName: this.bankName,
        bankCode: this.bankCode,
        currency: this.currency,
        monthlyLimit: `$${this.monthlyLimit.toLocaleString()} USD`,
        supportedTransactions: this.supportedTransactions
    };
});

// Pre-save middleware to update timestamps
usdVirtualAccountSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    
    // Set specific timestamps based on status changes
    if (this.isModified('status')) {
        const now = new Date();
        switch (this.status) {
            case 'approved':
                if (!this.approvedAt) this.approvedAt = now;
                break;
            case 'issued':
                if (!this.issuedAt) this.issuedAt = now;
                if (!this.approvedAt) this.approvedAt = now;
                break;
            case 'closed':
                if (!this.closedAt) this.closedAt = now;
                break;
        }
    }
    
    next();
});

// Static method to find account by user
usdVirtualAccountSchema.statics.findByUser = function(userId) {
    return this.findOne({ userId: userId });
};

// Static method to find active accounts
usdVirtualAccountSchema.statics.findActiveAccounts = function() {
    return this.find({ isActive: true, status: 'issued' });
};

// Static method to get account statistics
usdVirtualAccountSchema.statics.getStats = function() {
    return this.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 }
            }
        }
    ]);
};

// Instance method to update status
usdVirtualAccountSchema.methods.updateStatus = function(newStatus, reason = null) {
    this.status = newStatus;
    if (reason) {
        if (newStatus === 'declined') {
            this.declineReason = reason;
        } else if (newStatus === 'closed') {
            this.closureReason = reason;
            this.isActive = false;
        }
    }
    return this.save();
};

// Instance method to activate account
usdVirtualAccountSchema.methods.activate = function(accountInfo) {
    this.status = 'issued';
    this.isActive = true;
    this.accountNumber = accountInfo.accountNumber;
    this.bankName = accountInfo.bankName;
    this.bankCode = accountInfo.bankCode;
    this.accountReference = accountInfo.reference;
    return this.save();
};

module.exports = mongoose.model('UsdVirtualAccount', usdVirtualAccountSchema);