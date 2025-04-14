const adminModel = require("../../model/admin/admin.Model");
const forgetPwdModel = require("../../model/forgetPwdModel");
const { generateOtp, Sendmail } = require("../../utils/mailer.util");
const ErrorDisplay = require("../../utils/random.util");
const bcrypt = require('bcryptjs');

const ForgetPassword = async (req, res) => {
    try {
        const Email = req.query.email

        const user = await adminModel.findOne({Email});
        if(!user)return res.status(400).json({Error:true, Message:"user not found"});

        // ❗ Cooldown: check if OTP was already sent recently
        const lastOtp = await forgetPwdModel.findOne({ userId: user._id }).sort({ createdAt: -1 });

        if (lastOtp) {
          const now = new Date();
          const timeDiffInSeconds = (now - new Date(lastOtp.createdAt)) / 1000;

          if (timeDiffInSeconds < 60) {
            return res.status(429).json({
              Error: true,
              Message: `Please wait ${Math.ceil(60 - timeDiffInSeconds)}s before requesting a new OTP.`,
            });
          }
        }
        const Otp = generateOtp();
        await forgetPwdModel.create({
            userId:user.id,
            Otp:Otp
        });

        await Sendmail(Email, "Reset Password Using Otp",
          `
          <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SwiftPay OTP</title>
  <style>
    body {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    }
    .brand-logo {
      font-weight: bold;
      font-size: 24px;
      color: #d4af37;
      margin-bottom: 10px;
    }
    .divider {
      width: 100%;
      height: 4px;
      background-color: #000;
      margin-top: 5px;
      margin-bottom: 30px;
    }
    h2 {
      color: #222;
      font-size: 20px;
    }
    .otp-box {
      display: inline-block;
      padding: 16px 32px;
      background-color: #d4af37;
      color: #000;
      font-weight: bold;
      font-size: 28px;
      border-radius: 8px;
      margin: 20px 0;
      letter-spacing: 4px;
    }
    a {
      color: #d4af37;
      text-decoration: none;
    }
    .footer {
      margin-top: 40px;
      font-size: 0.85rem;
      color: #777;
      text-align: center;
    }
    .footer-divider {
      width: 100%;
      height: 2px;
      background-color: #000;
      margin: 40px 0 10px;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="brand-logo">SwiftPay</div>
    <div class="divider"></div>

    <h2>Reset Your Password Using OTP</h2>
    <p>Hi <strong>${user.FirstName}</strong>,</p>
    <p>You're receiving this email because you requested a password reset on your SwiftPay account.</p>
    <p>Please use the OTP below to continue:</p>

    <div class="otp-box">${Otp}</div>

    <p>This OTP is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>

    <p>If you did not initiate this request, please ignore this message or contact our support team immediately at
      <a href="mailto:support@jessy-codes.com.ng">support@swiftpay.com</a>.
    </p>

    <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #d4af37;">
      — The SwiftPay Team
    </p>

    <div class="footer-divider"></div>

    <div class="footer">
      © 2025 SwiftPay. All rights reserved.<br />
      Abuja, Nigeria
    </div>
  </div>
</body>
</html>

          `
        );
        res.status(200).json({Error:false, Message:"otp sent to email"})
    } catch (error) {
        console.log('error sending otp', error);
        res.status(400).json({Error:ErrorDisplay(error).msg})
    }
}

const ResetPassword = async(req, res) => {
    // Password regex: at least 4 chars, includes a letter & a number
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{6,}$/;

    try {
        const Email = req.query.email;
        const {Otp, Password} = req.body;

        const user = await adminModel.findOne({Email});
        if(!user) return res.status(400).json({Error:true, Message:"user not found"});

        const verifyOtp = await forgetPwdModel.findOne({userId:user.id,Otp});
        if(!verifyOtp) return res.status(400).json({Error:true, Message:"invalid Otp or Expired"})

        if(Password.length<6) return res.status(400).json({Error:true, Message:"Password is short min of 6 chars"})
        if(!passwordRegex.test(Password)) return res.status(400).json({Error:true, Message:"Password must contain at least one special chars"})

        const hashPwd = await bcrypt.hash(Password, 10);

        await adminModel.updateOne({ _id: user._id }, { Password: hashPwd });
        await forgetPwdModel.findOneAndDelete({userId:user.id,Otp});

        res.status(200).json({Error:false, Message:" Password Reset successful"});
    } catch (error) {
        console.log('error verifying otp', error);
        res.status(400).json({Error:ErrorDisplay(error).msg});
    }
}

module.exports = {
    ForgetPassword,
    ResetPassword
}