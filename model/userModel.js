const mongoose = require("mongoose");

const UserModel = new mongoose.Schema(
  {
    FirstName: {
      type: String,
      required: true,
    },
    LastName: {
      type: String,
      required: true,
    },
    Email: {
      type: String,
      required: true,
      unique: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/,
        "invalid Email",
      ],
    },
    Password: {
      type: String,
      required: true,
      minlength: 6,
    },
    Phone: {
      type: String,
      required: true,
    },
    EmailVerif: {
      type: Boolean,
      default: false,
    },
    EmailToken: {
      type: String, //for email verification link
    },
    isprofileVerified:{
      type: Boolean,
      default:false
    },
    isKycVerified: { 
      type: Boolean, 
      default: false 
    },
    KycType: { 
      type: String,
      enum: ['voters_card', 'nin', 'bvn'] // for consistency
    },
    KycDetails: { 
      type: Object 
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserModel);
