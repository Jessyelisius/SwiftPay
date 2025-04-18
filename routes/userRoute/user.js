const express = require("express");
const {
  Registration,
  verifyEmail,
} = require("../../controller/UserContrl/Register");
const Login = require("../../controller/UserContrl/Login");
const { ForgetPassword, ResetPassword } = require("../../controller/UserContrl/ForgetPassword");

const router = express.Router();

router.post("/register", Registration);
router.get("/verify-email", verifyEmail);
router.post("/login", Login);
router.get('/forgetPassword', ForgetPassword);
router.post('/resetPassword', ResetPassword);

module.exports = router;
