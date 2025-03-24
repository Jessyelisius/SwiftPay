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
        default:0
    },
    currency:{
        type:String,
        default: 'USD'
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