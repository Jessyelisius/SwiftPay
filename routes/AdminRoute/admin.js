const express = require('express');
const { Register, verifyEmail } = require('../../controller/AdminContrl/Register');
const Login = require('../../controller/AdminContrl/Login');
const { ForgetPassword, ResetPassword } = require('../../controller/AdminContrl/ForgetPassword');
const router = express.Router();

router.post('/register', Register);
router.get('/verify-email', verifyEmail);
router.post('/login', Login);
router.get('/forgetPassword', ForgetPassword);
router.post('/resetPassword', ResetPassword);

module.exports = router;