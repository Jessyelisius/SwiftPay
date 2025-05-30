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
    virtualAccount:{
        type: Object,
    },
    // accountDetails:{
    //     type: Object
    // },
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