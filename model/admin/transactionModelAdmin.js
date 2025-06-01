const mongoose = require('mongoose');

const AdminTransactionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
},
  amount: { 
    type: Number, 
    required: true 
},
  method:{
    type:String,
    enum:['card', 'visual_account'],
    default:'visual_account'
},
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'transfer'], 
    required: true 
},
  status: { 
    type: String, 
    enum: ['pending', 'successful', 'failed'], 
    default: 'pending' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
},
reference:{
    type: String,
    required: true,
    unique: true
},
korapayReference:{
    type: String,
      required: true,
      unique: true
  }

},{timestamps:true});

module.exports = mongoose.model('AdminTransaction', AdminTransactionSchema);