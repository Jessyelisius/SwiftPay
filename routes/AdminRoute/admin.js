const express = require('express');
const { Register, verifyEmail } = require('../../controller/AdminContrl/Register');
const Login = require('../../controller/AdminContrl/Login');
const { ForgetPassword, ResetPassword } = require('../../controller/AdminContrl/ForgetPassword');
const { verifyAdminJwt } = require('../../middleware/jwtAuth');
const { ApproveKYC, RejectKYC } = require('../../controller/AdminContrl/kycApprove');
const router = express.Router();

router.post('/register', Register);
router.get('/verify-email', verifyEmail);
router.post('/login', Login);
router.get('/forgetPassword', ForgetPassword);
router.post('/resetPassword', ResetPassword);
router.get('/approvekyc', verifyAdminJwt, ApproveKYC);
router.post('/rejectkyc', verifyAdminJwt, RejectKYC);

module.exports = router;