const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
    userid: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: [true, "user id ir required"]
    },
    idType: { 
      type: String, 
      enum: ['voters_card', 'nin', 'bvn'], 
      required: [true, "pls use any of the above. nin, voters_card or bvn"] 
    },
    idNumber: { 
      type: String, 
      required: [true, 'id number is required'] 
    },
   
    status: { 
      type: String, 
      enum: ['pending', 'approved', 'rejected'], 
      default: 'pending' 
    },
    reasonForRejection: { 
      type: String,
      // required:[true, 'reason For Rejection is required'] 
    }
  }, { timestamps: true });
  
  module.exports = mongoose.model("KYC", kycSchema);