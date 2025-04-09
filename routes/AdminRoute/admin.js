const express = require('express');
const { Register, verifyEmail } = require('../../controller/AdminContrl/Register');
const router = express.Router();

router.post('/register', Register);
router.get('/verify-email', verifyEmail);

module.exports = router;