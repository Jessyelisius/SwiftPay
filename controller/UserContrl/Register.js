const userModel = require("../../model/userModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateLink, Sendmail } = require("../../utils/mailer.util");

const Registration = async (req, res) => {
  // Email regex pattern for basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Password regex: at least 4 chars, includes a letter & a number
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{4,}$/;

  try {
    const Input = req.body;
    if (!Input.FirstName)
      return res
        .status(400)
        .json({ Error: true, Message: "Firstname is required" });
    if (!Input.LastName)
      return res
        .status(400)
        .json({ Error: true, Message: "Lastname is required" });
    if (!Input.Email)
      return res
        .status(400)
        .json({ Error: true, Message: "Email is required" });
    if (Input.Password.length < 6)
      return res
        .status(400)
        .json({ Error: true, Message: "Password is short, min of 6 chars" });
    if (!passwordRegex.test(Input.Password))
      return res.status(400).json({
        Error: true,
        Message: "Password must contain at least one letter and one number",
      });
    if (!Input.Phone)
      return res
        .status(400)
        .json({ Error: true, Message: "Phone number is required" });

    const existingUser = await userModel.findOne({ Email: Input.Email });
    if (existingUser)
      return res
        .status(400)
        .json({ Error: true, Message: "User exist, pls login" });

    const hashpwd = bcrypt.hashSync(Input.Password, 10);

    //generate Email verifcation token
    const emailToken = jwt.sign(
      {
        Email: Input.Email,
      },
      process.env.jwt_secret_token,
      { expiresIn: "1hr" }
    );

    const user = await userModel.create({
      FirstName: Input.FirstName,
      LastName: Input.LastName,
      Email: Input.Email,
      Password: hashpwd,
      Phone: Input.Phone,
      EmailToken: emailToken, ///to store the token
      EmailVerif: false, //mark as unverified
    });

    //send email verification token
    const verifyLink = generateLink(user.Email, "verify-email");
    console.log(verifyLink); // Debug: See the generated link

    await Sendmail(
      Input.Email,
      "Verify Your SwiftPay Email Address",
      `
      <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email</title>
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
        .verify-button {
            display: inline-block;
            padding: 12px 20px;
            font-size: 16px;
            font-weight: bold;
            color: #ffffff;
            background-color: #d4af37;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s ease-in-out;
        }
        .verify-button:hover {
            background-color: #b5932d;
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
    <div class="header">Verify Your Email</div>
    <p class="message">Hi <b>${Input.FirstName}</b>,</p>
    <p class="message">
        Thank you for signing up! Please verify your email address to activate your account.
    </p>
    <a href="${verifyLink}" class="verify-button">Verify My Email</a>
    <p class="message">If you did not sign up for this account, you can safely ignore this email.</p>
    <div class="footer">
        &copy; 2025 SwiftPay. All rights reserved. <br>
        Need help? <a href="mailto:support@jessy-codes.com.ng">Contact Support</a>
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
    console.log("error creating user", error);
    res.status(400).json({ Error: true, Message: "Registration failed" });
  }
};

//route to verify email

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token)
      return res.status(400).json({ Error: true, Message: "Invalid token" });

    const decoded = jwt.verify(token, process.env.jwt_secret_token);
    const user = await userModel.findOne({ Email: decoded.Email });

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
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verified Successfully</title>
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
            color: #4CAF50;
        }
        .message {
            font-size: 16px;
            color: #333333;
            margin: 20px 0;
        }
        .success-icon {
            font-size: 50px;
            color: #4CAF50;
        }
        .button {
            display: inline-block;
            padding: 12px 20px;
            font-size: 16px;
            font-weight: bold;
            color: #ffffff;
            background-color: #4CAF50;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s ease-in-out;
        }
        .button:hover {
            background-color: #388E3C;
        }
        .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #777777;
        }
        .footer a {
            color: #4CAF50;
            text-decoration: none;
        }
    </style>
</head>
<body>

<div class="container">
    <div class="header">✅ Email Verified Successfully!</div>
    <p class="message">Hi <b>${user.FirstName}</b>,</p>
    <p class="message">
        Your email has been successfully verified. You can now log in and enjoy full access to SwiftPay.
    </p>
    <a href="{{LoginURL}}" class="button">Login to SwiftPay</a>
    <p class="message">If you did not request this, please contact our support team.</p>
    <div class="footer">
        &copy; 2025 SwiftPay. All rights reserved. <br>
        Need help? <a href="mailto:support@swiftpay.com">Contact Support</a>
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
    res.status(400).json({ Error: true, Message: "Verification failed" });
  }
};
module.exports = {
  Registration,
  verifyEmail,
};
