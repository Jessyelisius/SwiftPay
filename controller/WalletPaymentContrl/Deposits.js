const axios = require("axios");
const { default: mongoose } = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const walletModel = require("../../model/walletModel");
const ErrorDisplay = require('../../utils/random.util');
const encryptKorapayPayload = require('../../utils/encryption.util');
const transactions = require('../../model/transactionModel');

const DepositWithCard = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = req.user;
        if (!user?.isKycVerified) return res.status(403).json({ Error: true, Message: "KYC not verified" });
        if (!user?.isprofileVerified) return res.status(403).json({ Error: true, Message: "Profile not verified" });

        if (req.query.checkSavedCard) {
            const saveCardDetails = await walletModel.findOne({ userId: user._id });
            if (!saveCardDetails?.virtualAccount) {
                return res.status(404).json({ Error: true, Message: "No saved card found" });
            }
            return res.status(200).json({
                hasCard: true,
                card: {
                    last4: saveCardDetails.virtualAccount.number,
                    expiry_month: saveCardDetails.virtualAccount.expiry_month,
                    expiry_year: saveCardDetails.virtualAccount.expiry_year
                }
            });
        }

        const { amount, currency, card, saveCard } = req.body;
        if (!amount || !card?.number || !card.expiry_month || !card?.expiry_year || !card?.cvv || !currency) {
            return res.status(400).json({ Error: true, Message: "Invalid card details" });
        }

        // Convert amount to Naira (keep as decimal, not kobo)
        const amountInNaira = parseFloat(amount);
        if (amountInNaira < 100 || amountInNaira > 10000) {
            return res.status(400).json({
                Error: true,
                Message: "Amount must be between ₦100 and ₦10,000",
                Code: "INVALID_AMOUNT"
            });
        }

        // Convert to kobo only for KoraPay API
        const amountInKobo = Math.round(amountInNaira * 100);

        const reference = `SWIFTPAY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

        // Store amount in Naira in database
        const newTransaction = new transactions({
            userId: user._id,
            amount: amountInNaira, // Store in Naira, not kobo
            currency,
            method: 'card',
            type: 'deposit',
            status: 'pending',
            reference
        });

        await newTransaction.save({ session });

        const payload = {
            amount: amountInKobo, // Send kobo to KoraPay
            currency,
            reference,
            customer: {
                name: user.FirstName,
                email: user.Email,
            },
            card: {
                number: card.number,
                cvv: card.cvv,
                expiry_month: card.expiry_month,
                expiry_year: card.expiry_year
            }
        };

        const encryptionKey = process.env.encryption_key;
        if (!encryptionKey) {
            await session.abortTransaction();
            return res.status(500).json({ Error: true, Message: "Configuration error" });
        }

        const encryptedPayload = encryptKorapayPayload(encryptionKey, payload);

        const integrateCard = await axios.post(
            "https://api.korapay.com/merchant/api/v1/charges/card",
            { charge_data: encryptedPayload },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json"
                }
            }
        );

        // Debug the response
        console.log('=== KORAPAY DEBUG ===');
        console.log('API Response:', JSON.stringify(integrateCard.data, null, 2));
        console.log('=== END DEBUG ===');

        const chargeData = integrateCard.data?.data;
        const chargeStatus = chargeData?.status;
        
        // Fix: Get KoraPay reference properly
        let korapayReference = chargeData?.reference;
        
        // If no reference from KoraPay, keep our original reference
        if (!korapayReference) {
            console.log('No KoraPay reference found, using original reference');
            korapayReference = reference;
        }

        console.log('Original Reference:', reference);
        console.log('KoraPay Reference:', korapayReference);

        // Update transaction with KoraPay reference
        await newTransaction.updateOne({ 
            korapayReference: korapayReference 
        }, { session });

        if (!integrateCard.data?.status || chargeStatus === 'failed') {
            await newTransaction.updateOne({ status: 'failed' }, { session });
            await session.commitTransaction();

            return res.status(400).json({
                Error: true,
                Message: integrateCard.data?.message || "Card charge failed",
                Code: "CHARGE_FAILED"
            });
        }

        // Fix: Use correct status value that matches your model
        const transactionStatus = chargeStatus === 'success' ? 'successful' : 'pending';

        const updateData = {
            $push: {
                transactions: {
                    type: 'deposit',
                    amount: amountInNaira, // Store in Naira
                    method: 'card',
                    status: transactionStatus,
                    reference: korapayReference,
                    currency
                }
            }
        };

        if (saveCard && chargeData?.authorization) {
            updateData.virtualAccount = {
                number: card.number.slice(-4),
                expiry_month: card.expiry_month,
                expiry_year: card.expiry_year,
                authorization: chargeData.authorization
            };
        }

        await walletModel.updateOne({ userId: user._id }, updateData, { session });

        if (chargeStatus === 'success') {
            await newTransaction.updateOne({ status: 'successful' }, { session });
            await walletModel.updateOne(
                { userId: user._id },
                { $inc: { balance: amountInNaira } }, // Increment in Naira
                { session }
            );

            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Status: "success",
                Message: "Payment Successful",
                Data: {
                    reference: korapayReference,
                    amount: amountInNaira, // Return in Naira
                    currency
                }
            });
        }

        // Fix: Better handling of undefined authMode
        const authMode = chargeData?.authorization?.mode;
        const nextStep = authMode ? authMode.toUpperCase() : "VERIFICATION";
        const message = authMode ? `Card requires ${authMode.toUpperCase()}` : "Card requires verification";

        await session.commitTransaction();

        return res.status(200).json({
            Error: false,
            Message: message,
            NextStep: `Enter ${nextStep}`,
            Reference: korapayReference, // Return KoraPay reference
            Mode: authMode || "verification"
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('DepositWithCard Error:', error);
        return res.status(400).json({
            Error: true,
            Message: ErrorDisplay(error).msg,
            Code: error.response?.data?.code || "PROCESSING_ERROR"
        });
    } finally {
        session.endSession();
    }
};

// POST /api/card/pin
const submitCardPIN = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { pin, reference } = req.body;
        if (!pin || !reference) {
            return res.status(400).json({
                Error: true,
                Code: "INVALID_INPUT",
                Message: "PIN and reference are required"
            });
        }

        const response = await axios.post(
            "https://api.korapay.com/merchant/api/v1/charges/card/authorize",
            {
                transaction_reference: reference,
                authorization: { pin }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const data = response.data.data;
        console.log('PIN Response:', JSON.stringify(data, null, 2));

        // Find and update transaction with new KoraPay reference if provided
        const transaction = await transactions.findOne({ 
            $or: [{ reference }, { korapayReference: reference }] 
        });

        let finalReference = reference;
        if (transaction && data.reference && transaction.korapayReference !== data.reference) {
            transaction.korapayReference = data.reference;
            await transaction.save({ session });
            finalReference = data.reference;
        }

        const status = data?.status;
        const amount = data.amount ? data.amount / 100 : transaction?.amount || 0; // Convert from kobo to Naira
        
        // Fix: Use correct status values
        const dbStatus = status === 'success' ? 'successful' : 'pending';

        await transactions.updateOne(
            { $or: [{ reference }, { korapayReference: reference }] },
            {
                status: dbStatus,
                updatedAt: new Date()
            },
            { session }
        );

        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": dbStatus,
                    "transactions.$.updatedAt": new Date()
                },
                ...(status === 'success' && { $inc: { balance: amount } }) // Amount already in Naira
            },
            { session }
        );

        await session.commitTransaction();

        if (data?.authorization?.mode === "otp") {
            return res.status(200).json({
                Error: false,
                Status: "pending",
                Message: "PIN accepted. OTP required.",
                Reference: finalReference,
                Mode: "otp"
            });
        }

        return res.status(200).json({
            Error: false,
            Status: status,
            Message: status === 'success' ? "Payment Successful" : "Processing payment...",
            Reference: finalReference
        });

    } catch (err) {
        await session.abortTransaction();
        console.error('SubmitCardPIN Error:', err);

        // Update transaction as failed
        await transactions.updateOne(
            { $or: [{ reference: req.body.reference }, { korapayReference: req.body.reference }] },
            { status: 'failed', updatedAt: new Date() }
        );

        return res.status(err.response?.status || 500).json({
            Error: true,
            Code: err.response?.data?.code || "PROCESSING_ERROR",
            Message: err.response?.data?.message || "PIN submission failed"
        });
    } finally {
        session.endSession();
    }
};

// POST /api/card/otp
const submitCardOTP = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { otp, reference } = req.body;
        if (!otp || !reference) {
            return res.status(400).json({
                Error: true,
                Code: "INVALID_INPUT",
                Message: "OTP and reference are required"
            });
        }

        const response = await axios.post(
            "https://api.korapay.com/merchant/api/v1/charges/card/authorize",
            {
                transaction_reference: reference,
                authorization: { otp }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const data = response.data.data;
        console.log('OTP Response:', JSON.stringify(data, null, 2));

        // Find and update transaction with new KoraPay reference if provided
        const transaction = await transactions.findOne({ 
            $or: [{ reference }, { korapayReference: reference }] 
        });

        let finalReference = reference;
        if (transaction && data.reference && transaction.korapayReference !== data.reference) {
            transaction.korapayReference = data.reference;
            await transaction.save({ session });
            finalReference = data.reference;
        }

        const status = data?.status;
        const amount = data.amount ? data.amount / 100 : transaction?.amount || 0; // Convert from kobo to Naira
        
        // Fix: Use correct status values
        const dbStatus = status === 'success' ? 'successful' : 'pending';

        await transactions.updateOne(
            { $or: [{ reference }, { korapayReference: reference }] },
            {
                status: dbStatus,
                updatedAt: new Date()
            },
            { session }
        );

        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": dbStatus,
                    "transactions.$.updatedAt": new Date()
                },
                ...(status === 'success' && { $inc: { balance: amount } }) // Amount already in Naira
            },
            { session }
        );

        await session.commitTransaction();

        return res.status(200).json({
            Error: false,
            Status: status,
            Message: status === 'success' ? "Payment Successful" : "Processing payment...",
            Reference: finalReference
        });

    } catch (err) {
        await session.abortTransaction();
        console.error('SubmitCardOTP Error:', err);

        // Update transaction as failed
        await transactions.updateOne(
            { $or: [{ reference: req.body.reference }, { korapayReference: req.body.reference }] },
            { status: 'failed', updatedAt: new Date() }
        );

        return res.status(err.response?.status || 500).json({
            Error: true,
            Code: err.response?.data?.code || "PROCESSING_ERROR",
            Message: err.response?.data?.message || "OTP submission failed"
        });
    } finally {
        session.endSession();
    }
};

module.exports = {
    DepositWithCard,
    submitCardPIN,
    submitCardOTP
};