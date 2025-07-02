// You'll also need a VirtualAccount model schema like this:
const mongoose = require('mongoose')

const virtualAccountSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    accountNumber: {
        type: String,
        required: true,
        unique: true
    },
    accountName: {
        type: String,
        required: true
    },
    bankName: {
        type: String,
        required: true
    },
    bankCode: {
        type: String,
        required: true
    },
    accountReference: {
        type: String,
        required: true,
        unique: true
    },
    korapayAccountId: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
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

const VirtualAccount = mongoose.model('VirtualAccount', virtualAccountSchema);

module.exports = VirtualAccount;
