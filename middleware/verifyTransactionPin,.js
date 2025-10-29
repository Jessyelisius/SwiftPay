const profileModel = require('../model/profile.Model');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const pinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: {
        Error: true,
        Message: "Too many failed PIN attempts. Please try again in 15 minutes."
    }
});


const verifyTransactionPin = async (req, res, next) => {
    try {
        const { transactionPin } = req.body;
        
        if (!transactionPin) {
            return res.status(400).json({
                Error: true,
                Message: "Transaction PIN is required"
            });
        }

        const profile = await profileModel.findOne({ user: req.user._id });
        
        if (!profile || !profile.transactionPin) {
            return res.status(400).json({
                Error: true,
                Message: "Please set up your transaction PIN first"
            });
        }

        const isValidPin = await bcrypt.compare(transactionPin, profile.transactionPin);
        
        if (!isValidPin) {
            return res.status(401).json({
                Error: true,
                Message: "Invalid transaction PIN"
            });
        }

        next();
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: "PIN verification failed"
        });
    }
};

module.exports = {  verifyTransactionPin, pinLimiter };