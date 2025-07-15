const express = require('express');
const { verifyUserJwt } = require('../../middleware/jwtAuth');
const { DepositWithVisualAccount } = require('../../controller/WalletPaymentContrl/VirtualAccount');
const router = express.Router();

router.post('/virtualAccountCreation', verifyUserJwt, DepositWithVisualAccount);


// router.post('/withdraw', Withdraw);


module.exports = router;