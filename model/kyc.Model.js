const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
    userid: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: [true, "user id ir required"]
    },
    idType: { 
      type: String, 
      enum: ['passport', 'nin', 'bvn', 'driver_license'], 
      required: [true, "pls use any of the above"] 
    },
    idNumber: { 
      type: String, 
      required: [true, 'id number is required'] 
    },
    frontImage: { 
      type: String,
      required: [true, 'frontImage is required']
    }, // cloudinary URL or file path
    backImage: { 
      type: String,
      required: [true, 'backImage is required']
    },
    // selfieWithId: { 
    //   type: String,
    //   // required:[true, 'selfiewithId is required']
    // },
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