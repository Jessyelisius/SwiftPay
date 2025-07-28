const express = require('express');
const { getUserTransactionsAdmin, getTransactionAnalytics, getAllTransactions } = require("../../controller/AdminContrl/AdminTransaction/Transactions");
const { verifyUserJwt, verifyAdminJwt } = require("../../middleware/jwtAuth");
// const router = require("../walletRoute/wallet");

const router = express.Router();

// Admin routes for transactions
router.get('/All', verifyAdminJwt, getAllTransactions);
router.get('/UserTransact/:userId', verifyAdminJwt, getUserTransactionsAdmin);
router.get('/TransactionAnalytics', verifyAdminJwt, getTransactionAnalytics);