const adminModel = require("../../model/admin/admin.Model");
const bcrypt = require('bcryptjs');
const { generateLink, Sendmail } = require("../../utils/mailer.util");
const jwt = require('jsonwebtoken');
const ErrorDisplay = require("../../utils/random.util");

const Register = async(req, res) =>{

        //Basic Patterns
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/

    try {
        const Input = req.body

        if(!Input.FirstName) return res.status(400).json({ Error:true, Message:"Firstname is required"});
        if(!Input.LastName) return res.status(400).json({Error:true, Message:"Lastname is required" });
        if(!Input.Email || !emailRegex.test(Input.Email)) return res.status(400).json({Error:true, Message:"Invalid email format"});
        if(Input.Password?.length<6) return res.status(400).json({Error:true, Message:"Password is short min of 6 chars"});
        if(!passwordRegex.test(Input.Password)) return res.status(400).json({Error:true, Message:"Password mush contain special chars"});

        const existingUser = await adminModel.findOne({Email:Input.Email});
        if(existingUser) return res.status(400).json({Error:true, Message:"Admin email already in user"});

        //generate Email verifcation token
        const emailToken = jwt.sign(
            {
            Email: Input.Email,
            },
            process.env.jwt_secret_token,
            { expiresIn: "1hr" }
        );

        const hashPwd = await bcrypt.hash(Input.Password,10)
        const user = await adminModel.create({
            FirstName:Input.FirstName,
            LastName:Input.LastName,
            Email:Input.Email,
            Password:hashPwd,
            EmailToken: emailToken, ///to store the token
            EmailVerif: false, //mark as unverified
        });

        //send email verification token
    const verifyLink = generateLink(user.Email, "verify-email", "admin");
    console.log(verifyLink); // Debug: See the generated link

    await Sendmail(
      Input.Email,
      "Verify Your SwiftPay Email Address",
      `
      <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SwiftPay Email Verification</title>
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
    .verify-button {
      display: inline-block;
      padding: 14px 28px;
      background-color: #d4af37;
      color: #000;
      font-weight: bold;
      font-size: 16px;
      text-decoration: none;
      border-radius: 8px;
      margin: 20px 0;
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

    <h2>Verify Your SwiftPay Email Address</h2>
    <p>Hi <strong>${Input.FirstName}</strong>,</p>
    <p>Thanks for signing up to SwiftPay! To start using your account, please verify your email by clicking the button below:</p>

    <a href="${verifyLink}" class="verify-button">Verify Email</a>

    <p>This link will expire in <strong>30 minutes</strong>. If you didn’t create this account, you can safely ignore this email or contact our support at
      <a href="mailto:support@swiftpay.com">support@swiftpay.com</a>.
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
    res.status(200).json({
      Error: false,
      Message: "Verification email sent. Please verify before login.",
      Result: user,
    });

    } catch (error) {
        console.log("error registrying user",error);
        res.status(400).json({Error:ErrorDisplay(error).msg, Message:"cannot create user"})
    }
}


//route to verify email

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token)
      return res.status(400).json({ Error: true, Message: "Invalid token" });

    const decoded = jwt.verify(token, process.env.jwt_secret_token);
    const user = await adminModel.findOne({ Email: decoded.Email });

    if (!user)
      return res.status(400).json({ Error: true, Message: "user not found" });

    // if (user.EmailVerif)
    //   return res
    //     .status(200)
    //     .json({ Error: false, Message: "Email already verified" });

    (user.EmailVerif = true), (user.EmailToken = null); // set to null remove the token after verification
    await user.save();
    Sendmail(
      user.Email,
      "SwiftPay Email Verified",
        `
        <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Email Verified</title>
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
    .footer {
      margin-top: 40px;
      font-size: 0.85rem;
      color: #777;
      text-align: center;
    }
    a {
      color: #d4af37;
      text-decoration: none;
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

    <h2>Email Address Verified Successfully</h2>
    <p>Hi <strong>${user.FirstName}</strong>,</p>
    <p>We're glad to inform you that your email address has been successfully verified. You can now enjoy all features of your SwiftPay account.</p>

    <p>If this wasn’t you, or you notice any suspicious activity, please contact us immediately at
      <a href="mailto:support@swiftpay.com">support@swiftpay.com</a>.
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
    res
      .status(200)
      .json({ Error: false, Message: "Email verified. you can now login" });
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(400).json({ Error: ErrorDisplay(error).msg, Message: "Verification failed" });
  }
};

module.exports = {
    Register,
    verifyEmail
}