const express = require('express');
const { verifyUserJwt } = require('../../middleware/jwtAuth');
const { CreateVirtualAccount, getVirtualAccountDetails } = require('../../controller/WalletPaymentContrl/VirtualAccount');
const Transfer = require('../../controller/WalletPaymentContrl/Transfer');
const { userBalance } = require('../../controller/WalletPaymentContrl/Balance');
const { createWallet, getWallet, getBalance, updateBalance, hasSufficientBalance, addExternalWallet, getExternalWallet, getWalletSummary, testWalletOperations } = require('../../controller/CryptoCoin/walletService');
const { validateWalletAddress, addExternalWalletWithValidation, processCryptoWithdrawal, calculateNetworkFee, getWithdrawalHistory, checkWithdrawalStatus, testCryptoTransferOperations } = require('../../controller/CryptoCoin/cryptoTransferService');
const { CreateUsdVirtualAccount, getUsdVirtualAccountDetails } = require('../../controller/USD_Section/usdAccount');
const { uploadUsdKycDocuments, uploadUsdKycDocumentsLocal } = require('../../utils/uploadDocument.utils');
const router = express.Router();

// Virtual Account routes
router.post('/virtualAccountCreation', verifyUserJwt, CreateVirtualAccount);
router.get('/getVirtualAccountDetails', verifyUserJwt, getVirtualAccountDetails);

//usd virtual account 

// Use S3 if configured, otherwise local
const uploadMiddleware = process.env.AWS_S3_BUCKET ? uploadUsdKycDocuments : uploadUsdKycDocumentsLocal;

router.post('/createUsdVirtualAccount', verifyUserJwt, uploadMiddleware, CreateUsdVirtualAccount);
router.get('/getUsdVirtualAccountDetails', verifyUserJwt, getUsdVirtualAccountDetails);


//user balance route
router.get('/balance', verifyUserJwt, userBalance);

//crypto session
// router.post('/cryptoWallet', verifyUserJwt, createWallet, getWallet, getBalance, updateBalance, hasSufficientBalance, addExternalWallet, getExternalWallet, getWalletSummary, testWalletOperations);
// router.post('/cryptoTransfer', verifyUserJwt, validateWalletAddress, addExternalWalletWithValidation, processCryptoWithdrawal, calculateNetworkFee, getWithdrawalHistory, checkWithdrawalStatus, testCryptoTransferOperations);
module.exports = router;