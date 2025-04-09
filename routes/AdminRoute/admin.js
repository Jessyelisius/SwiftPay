const express = require('express');
const { Register, verifyEmail } = require('../../controller/AdminContrl/Register');
const Login = require('../../controller/AdminContrl/Login');
const router = express.Router();

router.post('/register', Register);
router.get('/verify-email', verifyEmail);
router.post('/login', Login);

module.exports = router;