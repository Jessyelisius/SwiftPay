const express = require('express');
const { verifyUserJwt } = require('../../middleware/jwtAuth');
const { DepositWithVirtualAccount, getVirtualAccountDetails } = require('../../controller/WalletPaymentContrl/VirtualAccount');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const router = express.Router();

router.post('/virtualAccountCreation', verifyUserJwt, DepositWithVirtualAccount);
router.get('/getVirtualAccountDetails', verifyUserJwt, getVirtualAccountDetails);

router.post('/bank_transfer', verifyUserJwt, Transfer);

// router.post('/withdraw', Withdraw);


module.exports = router;