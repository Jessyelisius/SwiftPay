const mongoose = require("mongoose");

const forgetPwdSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    Otp: {
      type: Number,
      require: true,
    },
    Date: {
      type: Date.now(),
      ExpiresIn: "10m",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ForgetPassword", forgetPwdSchema);
