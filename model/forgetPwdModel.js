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
      type: Date.now(),
      ExpiresIn: "10m",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ForgetPassword", forgetPwdSchema);
