const adminModel = require("../../model/admin/admin.Model");
const forgetPwdModel = require("../../model/forgetPwdModel");
const { generateOtp, Sendmail } = require("../../utils/mailer.util");
const ErrorDisplay = require("../../utils/random.util");
const bcrypt = require('bcryptjs');

const ForgetPassword = async (req, res) => {
    try {
        const Email = req.params.email

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
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>SwiftPay - Reset Password</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f6f6f6;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 30px auto;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
      padding: 30px;
      text-align: center;
    }
    .header {
      font-size: 24px;
      font-weight: bold;
      color: #d4af37;
    }
    .message {
      font-size: 16px;
      color: #333333;
      margin: 20px 0;
    }
    .otp-box {
      display: inline-block;
      background: #fff8e1;
      padding: 12px 20px;
      font-size: 20px;
      font-weight: bold;
      color: #d4af37;
      border-radius: 6px;
      margin: 20px 0;
      letter-spacing: 2px;
    }
    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: #777777;
    }
    .footer a {
      color: #d4af37;
      text-decoration: none;
    }
  </style>
</head>
<body>

  <div class="container">
    <div class="header">Reset Your Password</div>
    <p class="message">Hi <b>${user.FirstName}</b>,</p>
    <p class="message">
      We received a request to reset your SwiftPay account password. Use the OTP below to proceed:
    </p>
    <div class="otp-box">${Otp}</div>
    <p class="message">
      This code will expire in 10 minutes. If you didn't request a password reset, you can safely ignore this email.
    </p>
    <div class="footer">
      &copy; 2025 SwiftPay. All rights reserved. <br>
      Need help? <a href="mailto:support@jessy-codes.com.ng">Contact Support</a>
    </div>
  </div>

</body>
</html>

           `
        );
        res.status(200).json({Error:false, Message:"otp send to email"})
    } catch (error) {
        console.log('error sending otp', error);
        res.status(400).json({Error:ErrorDisplay(error).msg})
    }
}

const ResetPassword = async(req, res) => {
    // Password regex: at least 4 chars, includes a letter & a number
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{6,}$/;

    try {
        const Email = req.params.email;
        const {Otp, Password} = req.body;

        const user = await adminModel.findOne({Email});
        if(!user) return res.status(400).json({Error:true, Message:"user not found"});

        const verifyOtp = await forgetPwdModel.findOne({userId:user.id,Otp});
        if(!verifyOtp) return res.status(400).json({Error:true, Message:"invalid Otp or Expired"})

        if(Password.length<6) return res.status(400).json({Error:true, Message:"Password is short min of 6 chars"})
        if(!passwordRegex.test(Password)) return res.status(400).json({Error:true, Message:"Password must contain at least one special chars"})

        const hashPwd = bcrypt.hash(Password, 10);

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