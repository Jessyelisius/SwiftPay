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
        type:Number,
        default:0,
        required:true,
        min:[0,"Balance is too small"]
    },
    currency:{
        type:String,
        enum:['NGN', 'USD'],
        default: 'NGN'
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