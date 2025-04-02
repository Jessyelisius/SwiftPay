const express = require('express');
const validationToken = require('../../middleware/jwtAuth');
const { getUserTransaction, Transfer } = require('../../controller/Wallet/transactionContr');

const router = express.Router();

router.get('/history', validationToken, getUserTransaction);
router.post('/transfer', validationToken, Transfer);


module.exports = router