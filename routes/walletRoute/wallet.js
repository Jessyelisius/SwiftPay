const express = require('express');
const validationToken = require('../../middleware/jwtAuth');
const { Deposit, Withdraw } = require('../../controller/Wallet/walletContr');

const router = express.Router();

router.get('/deposit', async(req, res) =>{

})

router.post('/deposit', validationToken, Deposit);
router.post('/withdraw', validationToken, Withdraw);


module.exports = router;