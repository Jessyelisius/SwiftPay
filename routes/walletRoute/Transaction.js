const express = require('express');
const {validationToken, verifyUserJwt} = require('../../middleware/jwtAuth');
const { DepositWithCard, submitCardPIN, submitCardOTP, DepositWithVisualAccount } = require('../../controller/WalletPaymentContrl/Deposits');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const { getTransactionHistory, getSingleTransaction, getUserTransactionSummary } = require('../../controller/WalletPaymentContrl/transactionContr');
const { fetchUsdToNgnRate, fetchCryptoPrices, getRate } = require('../../controller/CryptoCoin/conversion');
const { getConversionQuote, processConversion, getConversionHistory, savePriceHistory } = require('../../controller/CryptoCoin/conversionService');
const { getWallet, getBalance, addExternalWallet, getExternalWallet, createWallet } = require('../../controller/CryptoCoin/walletService');
const { validateWalletAddress, processCryptoWithdrawal, getWithdrawalHistory, checkWithdrawalStatus, calculateNetworkFee, supportedNetworks } = require('../../controller/CryptoCoin/cryptoTransferService');

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
router.get('/singleTransact/:transactionId', verifyUserJwt, getSingleTransaction);
router.get('/summary', verifyUserJwt, getUserTransactionSummary);


// Cryptocurrency section
router.get('/ngnRate', verifyUserJwt, fetchUsdToNgnRate);
router.get('/cryptoPrices', verifyUserJwt, fetchCryptoPrices);
router.get('/quote', verifyUserJwt, getConversionQuote);
router.post('/convert', verifyUserJwt, processConversion);
router.get('/conversion-history', verifyUserJwt, getConversionHistory);

// Crypto wallet routes
router.post('/wallet/create', verifyUserJwt, createWallet);
router.get('/wallet/summary', verifyUserJwt, getWallet);
router.get('/wallet/balance/:currency', verifyUserJwt, getBalance);
router.post('/wallet/external/add', verifyUserJwt, addExternalWallet);
router.get('/wallet/external', verifyUserJwt, getExternalWallet);
router.post('/wallet/external/validate', verifyUserJwt, validateWalletAddress);

// Crypto withdrawal routes
router.post('/withdraw', verifyUserJwt, processCryptoWithdrawal);
router.get('/withdraw/history', verifyUserJwt, getWithdrawalHistory);
router.get('/withdraw/status/:reference', verifyUserJwt, checkWithdrawalStatus);
router.get('/networks/:currency', verifyUserJwt, supportedNetworks);
router.get('/network-fee/:currency', verifyUserJwt, calculateNetworkFee);

// Price history routes
router.post('/price-history/save', verifyUserJwt, savePriceHistory);
router.get('/rate/:from/:to', verifyUserJwt, getRate);

module.exports = router;