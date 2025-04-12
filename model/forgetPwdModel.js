const mongoose = require("mongoose");

const forgetPwdSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, "userId is required"],
    },
    Otp: {
      type: Number,
      require: [true, "OTP is required"],
    },
    Date: {
      type: Date,
      default:Date.now(),
      ExpiresIn: 600,// 10 minutes in seconds
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ForgetPassword", forgetPwdSchema);
