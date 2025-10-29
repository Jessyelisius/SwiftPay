const express = require('express');
const {validationToken, verifyUserJwt} = require('../../middleware/jwtAuth');
const { DepositWithCard, submitCardPIN, submitCardOTP, DepositWithVisualAccount } = require('../../controller/WalletPaymentContrl/Deposits');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const { getTransactionHistory, getSingleTransaction, getUserTransactionSummary } = require('../../controller/WalletPaymentContrl/transactionContr');
const { pinLimiter, verifyTransactionPin } = require('../../middleware/verifyTransactionPin,');

const {
    fetchUsdToNgnRate,
    getPrices,
    getConversionQuote,
    processConversion,
    getConversionHistory,
    createWallet,
    getWallet,
    getBalance,
    addExternalWallet,
    getExternalWallet,
    validateWalletAddress,
    processCryptoWithdrawal,
    getWithdrawalHistory,
    checkWithdrawalStatus,
    supportedNetworks,
    calculateNetworkFee,
    savePriceHistory,
    getRate
} = require('../../controller/CryptoCoin/cryptoController');



const router = express.Router();

// Deposit routes
router.post('/deposit', verifyUserJwt, pinLimiter, verifyTransactionPin, DepositWithCard);
router.post('/card/pin', verifyUserJwt, submitCardPIN);
router.post('/card/otp', verifyUserJwt, submitCardOTP);

//bank transfer routes
router.post('/bank_transfer', verifyUserJwt, pinLimiter, verifyTransactionPin, Transfer);
// router.post('/depositwithvisualaccount', verifyUserJwt, DepositWithVisualAccount);


//history routes
router.get('/all', verifyUserJwt, getTransactionHistory);
router.get('/singleTransact/:transactionId', verifyUserJwt, getSingleTransaction);
router.get('/summary', verifyUserJwt, getUserTransactionSummary);


// Cryptocurrency section
router.get('/ngnRate', verifyUserJwt, fetchUsdToNgnRate);
router.get('/cryptoPrices', verifyUserJwt, getPrices);
router.get('/quote', verifyUserJwt, getConversionQuote);
router.post('/convert', verifyUserJwt, pinLimiter, verifyTransactionPin, processConversion);
router.get('/conversion-history', verifyUserJwt, getConversionHistory);

// Crypto wallet routes
router.post('/wallet/create', verifyUserJwt, createWallet);
router.get('/wallet/summary', verifyUserJwt, getWallet);
router.get('/wallet/balance/:currency', verifyUserJwt, getBalance);
router.post('/wallet/external/add', verifyUserJwt, pinLimiter, verifyTransactionPin, addExternalWallet);
router.get('/wallet/external', verifyUserJwt, getExternalWallet);
router.post('/wallet/external/validate', verifyUserJwt, validateWalletAddress);

// Crypto withdrawal routes
router.post('/withdraw', verifyUserJwt, pinLimiter, verifyTransactionPin, processCryptoWithdrawal);
router.get('/withdraw/history', verifyUserJwt, getWithdrawalHistory);
router.get('/withdraw/status/:reference', verifyUserJwt, checkWithdrawalStatus);
router.get('/networks/:currency', verifyUserJwt, supportedNetworks);
router.get('/network-fee/:currency', verifyUserJwt, calculateNetworkFee);

// Price history routes
router.post('/price-history/save', verifyUserJwt, savePriceHistory);
router.get('/rate/:from/:to', verifyUserJwt, getRate);

module.exports = router;
