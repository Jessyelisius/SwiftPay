const express = require('express');
const { verifyUserJwt } = require('../../middleware/jwtAuth');
const { CreateVirtualAccount, getVirtualAccountDetails } = require('../../controller/WalletPaymentContrl/VirtualAccount');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const { userBalance } = require('../../controller/WalletPaymentContrl/Balance');
const router = express.Router();

// Virtual Account routes
router.post('/virtualAccountCreation', verifyUserJwt, CreateVirtualAccount);
router.get('/getVirtualAccountDetails', verifyUserJwt, getVirtualAccountDetails);

//user balance route
router.get('/balance', verifyUserJwt, userBalance);

module.exports = router;