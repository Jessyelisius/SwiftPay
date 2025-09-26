const express = require('express');
const { verifyUserJwt } = require('../../middleware/jwtAuth');
const { CreateVirtualAccount, getVirtualAccountDetails } = require('../../controller/WalletPaymentContrl/VirtualAccount');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const { userBalance } = require('../../controller/WalletPaymentContrl/Balance');
const { createWallet, getWallet, getBalance, updateBalance, hasSufficientBalance, addExternalWallet, getExternalWallet, getWalletSummary, testWalletOperations } = require('../../controller/CryptoCoin/walletService');
const { validateWalletAddress, addExternalWalletWithValidation, processCryptoWithdrawal, calculateNetworkFee, getWithdrawalHistory, checkWithdrawalStatus, testCryptoTransferOperations } = require('../../controller/CryptoCoin/cryptoTransferService');
const { CreateUsdVirtualAccount, getUsdVirtualAccountDetails } = require('../../controller/USD_Section/usdAccount');
const router = express.Router();

// Virtual Account routes
router.post('/virtualAccountCreation', verifyUserJwt, CreateVirtualAccount);
router.get('/getVirtualAccountDetails', verifyUserJwt, getVirtualAccountDetails);

//usd virtual account 
router.post('/createUsdVirtualAccount', verifyUserJwt, CreateUsdVirtualAccount);
router.get('/getUsdVirtualAccountDetails', verifyUserJwt, getVirtualAccountDetails);


//user balance route
router.get('/balance', verifyUserJwt, userBalance);

//crypto session
// router.post('/cryptoWallet', verifyUserJwt, createWallet, getWallet, getBalance, updateBalance, hasSufficientBalance, addExternalWallet, getExternalWallet, getWalletSummary, testWalletOperations);
// router.post('/cryptoTransfer', verifyUserJwt, validateWalletAddress, addExternalWalletWithValidation, processCryptoWithdrawal, calculateNetworkFee, getWithdrawalHistory, checkWithdrawalStatus, testCryptoTransferOperations);
module.exports = router;