const express = require('express');
const {validationToken, verifyUserJwt} = require('../../middleware/jwtAuth');
const { DepositWithCard, submitCardPIN, submitCardOTP, DepositWithVisualAccount } = require('../../controller/WalletPaymentContrl/Deposits');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const { getTransactionHistory, getSingleTransaction, getUserTransactionSummary } = require('../../controller/WalletPaymentContrl/transactionContr');

const router = express.Router();

router.get('/deposit', async(req, res) =>{

})

// Deposit routes
router.post('/deposit', verifyUserJwt, DepositWithCard);
router.post('/card/pin', verifyUserJwt, submitCardPIN);
router.post('/card/otp', verifyUserJwt, submitCardOTP);

//bank transfer routes
router.post('/bank_transfer', verifyUserJwt, Transfer);
// router.post('/depositwithvisualaccount', verifyUserJwt, DepositWithVisualAccount);


//history routes
router.get('/all', verifyUserJwt, getTransactionHistory);
router.get('/history/:transactionId', verifyUserJwt, getSingleTransaction);
router.get('/summary', verifyUserJwt, getUserTransactionSummary);


module.exports = router;