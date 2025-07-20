const express = require('express');
const {validationToken, verifyUserJwt} = require('../../middleware/jwtAuth');
const { DepositWithCard, submitCardPIN, submitCardOTP, DepositWithVisualAccount } = require('../../controller/WalletPaymentContrl/Deposits');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');

const router = express.Router();

router.get('/deposit', async(req, res) =>{

})

router.post('/deposit', verifyUserJwt, DepositWithCard);
router.post('/card/pin', verifyUserJwt, submitCardPIN);
router.post('/card/otp', verifyUserJwt, submitCardOTP);
router.post('/bank_transfer', verifyUserJwt, Transfer);
// router.post('/depositwithvisualaccount', verifyUserJwt, DepositWithVisualAccount);


module.exports = router;