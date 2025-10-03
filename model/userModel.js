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
      // required: true,
      required: function() {
        return this.authProvider === 'local'; // Only required for local auth
      },
      minlength: 6,
    },
    Phone: {
      type: String,
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
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    appleId: {
        type: String,
        unique: true,
        sparse: true
    },
    authProvider: {
        type: String,
        enum: ['local', 'google', 'apple'],
        default: 'local'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserModel);
