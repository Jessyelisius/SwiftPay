const express = require('express');
const { verifyUserJwt } = require('../../middleware/jwtAuth');
const { CreateVirtualAccount, getVirtualAccountDetails } = require('../../controller/WalletPaymentContrl/VirtualAccount');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const router = express.Router();

router.post('/virtualAccountCreation', verifyUserJwt, CreateVirtualAccount);
router.get('/getVirtualAccountDetails', verifyUserJwt, getVirtualAccountDetails);

// router.post('/withdraw', Withdraw);


module.exports = router;