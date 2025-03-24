const mailer = require("nodemailer");
const randtoken = require("rand-token");
const jwt = require("jsonwebtoken");

const generateOtp = () => {
  return Math.floor(1000 + Math.random() * 9000);
};

const myemail = mailer.createTransport({
  service: process.env.service,
  host: process.env.host,

  port: 465,

  auth: {
    user: process.env.email,
    pass: process.env.pass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

const Sendmail = async (to, subject, html, many = false) => {
  try {
    const mailoption = {
      from: `${process.env.Company} <${process.env.email}>`,
      [many ? "bcc" : "to"]: to, //bcc for bulk, to for single
      //   ...{ bcc: to },
      subject: subject,
      html: html,
    };
    await myemail.sendMail(mailoption);
    return { sent: true };
  } catch (error) {
    console.log("Mail sending error:", error.message);
    return { error: error.message };
  }
};

// const sendOTP = async ({ to, subject, text }) => {
//   const mails = {
//     from: process.env.email,
//     to: to,
//     subject: subject,
//     text: text,
//   };
//   return transport.sendMail(mails);
// };

const sendOTP = async ({ to, subject, text }) => {
  try {
    const mailOptions = {
      from: process.env.email,
      to,
      subject,
      text,
    };
    return myemail.sendMail(mailOptions);
  } catch (error) {
    console.error("OTP Email error:", error.message);
    return { error: error.message };
  }
};

function generateLink(Email, type) {
  if (!type) throw new Error("Type is required in generateLink function");
  const token = jwt.sign({ Email }, process.env.jwt_secret_token, {
    expiresIn: "1hr",
  }); // Secure token
  return `${
    process.env.frontendURL
  }/auth/${type}?token=${token}&email=${encodeURIComponent(Email)}`;
}

// function Links() {
//   return randtoken.generate(16, "0123456789qwertyuiopasdfghjklzxcvbnm$.");
// }

module.exports = {
  Sendmail,
  sendOTP,
  generateOtp,
  generateLink,
};
