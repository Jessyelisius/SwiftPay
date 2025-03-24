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
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'transfer'], 
    required: true 
},
  status: { 
    type: String, 
    enum: ['pending', 'successful', 'failed'], 
    default: 'pending' },
  createdAt: { 
    type: Date, 
    default: Date.now 
},
},{timestamps:true});

module.exports = mongoose.model('Transaction', TransactionSchema);