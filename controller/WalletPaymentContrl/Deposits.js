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

        // Check if just requesting saved card info
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

        const amountInKobo = Math.round(parseFloat(amount) * 100);
        if (amountInKobo < 10000 || amountInKobo > 1000000) {
            return res.status(400).json({
                Error: true,
                Message: "Amount must be between ₦100 and ₦10,000",
                Code: "INVALID_AMOUNT"
            });
        }

        // Use a simpler reference that Korapay can handle
        const reference = `SWIFTPAY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

        const newTransaction = new transactions({
            userId: user._id,
            amount: amountInKobo,
            currency,
            method: 'card',
            type: 'deposit',
            status: 'pending',
            reference
        });
        
        await newTransaction.save({ session });
        console.log("Transaction created in database:", reference);

        const payload = {
            amount: amountInKobo,
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

        // Get encryption key from environment
        const encryptionKey = process.env.encryption_key;
        if (!encryptionKey) {
            console.error('KORAPAY_ENCRYPTION_KEY environment variable is not set');
            await session.abortTransaction();
            return res.status(500).json({ Error: true, Message: "Configuration error" });
        }

        // Encrypt the payload
        const encryptedPayload = encryptKorapayPayload(encryptionKey, payload);
        console.log("Encrypted payload:", encryptedPayload);

        const integrateCard = await axios.post(
            "https://api.korapay.com/merchant/api/v1/charges/card",
            {
                charge_data: encryptedPayload
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("Full Korapay Response:", JSON.stringify(integrateCard.data, null, 2));

        const chargeData = integrateCard.data?.data;
        const chargeStatus = chargeData?.status;
        
        // IMPORTANT: Store Korapay's actual reference for future use
        const korapayReference = chargeData?.reference || reference;
        
        // Update our transaction with Korapay's reference
        await newTransaction.updateOne({ 
            korapayReference: korapayReference 
        }, { session });

        if (!integrateCard.data?.status || chargeStatus === 'failed') {
            await newTransaction.updateOne({ status: 'failed' }, { session });
            await session.commitTransaction();
            
            return res.status(400).json({
                Error: true,
                Message: integrateCard.data?.message || "Card charge failed",
                Code: "CHARGE_FAILED",
                Details: chargeData?.response_message || "Card processing failed"
            });
        }

        if (chargeStatus === 'success') {
            await newTransaction.updateOne({ status: 'success' }, { session });
            
            // Update wallet transaction record
            await walletModel.updateOne(
                { userId: user._id },
                {
                    $push: {
                        transactions: {
                            type: 'deposit',
                            amount: amountInKobo / 100, // Store in Naira
                            method: 'card',
                            status: 'success',
                            reference: korapayReference,
                            currency
                        }
                    },
                    $inc: { balance: amountInKobo / 100 } // Add balance in Naira
                },
                { session }
            );
        
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Status: "success",
                Message: "Payment Successful - Processing...",
                Data: {
                    reference: korapayReference,
                    amount: amountInKobo / 100,
                    currency
                }
            });
        }

        // Handle card saving
        const cardToSave = {
            number: card.number.slice(-4),
            expiry_month: card.expiry_month,
            expiry_year: card.expiry_year,
            authorization: chargeData?.authorization || null
        };

        const updateData = {
            $push: {
                transactions: {
                    type: 'deposit',
                    amount: amountInKobo / 100,
                    method: 'card',
                    status: 'pending',
                    reference: korapayReference,
                    currency
                }
            }
        };

        if (saveCard) {
            updateData.virtualAccount = cardToSave;
        }

        await walletModel.updateOne(
            { userId: user._id },
            updateData,
            { session }
        );

        const authData = chargeData?.authorization;
        if (authData?.mode === "pin") {
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Message: "Card requires PIN",
                NextStep: "Enter card PIN",
                Reference: korapayReference, // Return Korapay's reference
                Mode: "pin"
            });
        } else if (authData?.mode === "otp") {
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Message: "Card requires OTP",
                NextStep: "Enter OTP",
                Reference: korapayReference, // Return Korapay's reference
                Mode: "otp"
            });
        } else if (authData?.mode === "redirect") { 
            if (!authData?.redirect_url) {
                throw new Error("Redirect URL missing from Korapay response");
            }
            
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Message: "Redirect to bank page required",
                RedirectURL: authData.redirect_url,
                Reference: korapayReference, // Return Korapay's reference
                Mode: "redirect"
            });
        }

        await session.commitTransaction();
        return res.status(200).json({
            Error: false,
            Message: "pending payment",
            Data: {
                reference: korapayReference,
                status: "pending_verification"
            }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error("Error Response:", error.response?.data);
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
                authorization: {
                    pin: pin
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log("Korapay PIN response:", response.data);

        const responseData = response.data.data;
        const nextAuth = responseData?.authorization;
        const isSuccess = responseData?.status === 'success';

        // Update both transaction collections
        await transactions.updateOne(
            { 
                $or: [
                    { reference: reference },
                    { korapayReference: reference }
                ]
            },
            {
                status: isSuccess ? 'success' : 'pending',
                updatedAt: new Date()
            },
            { session }
        );

        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": isSuccess ? "success" : "pending",
                    "transactions.$.updatedAt": new Date()
                }
            },
            { session }
        );

        if (isSuccess) {
            // Update wallet balance
            const amount = responseData.amount / 100; // Convert to Naira
            await walletModel.updateOne(
                { "transactions.reference": reference },
                {
                    $inc: { balance: amount }
                },
                { session }
            );
        }

        await session.commitTransaction();

        if (nextAuth?.mode === "otp") {
            return res.status(200).json({
                Error: false,
                Status: "pending",
                Message: "PIN accepted. OTP required.",
                NextStep: "Enter OTP",
                Reference: reference,
                Mode: "otp"
            });
        }

        return res.status(200).json({
            Error: false,
            Status: isSuccess ? "success" : "pending",
            Message: isSuccess ? "Payment Successful" : "Processing payment...",
            Data: {
                reference,
                amount: responseData?.amount || 0,
                currency: responseData?.currency
            }
        });

    } catch (err) {
        await session.abortTransaction();
        const statusCode = err.response?.status || 500;
        const errorMessage = err.response?.data?.message || "PIN submission failed";
        
        // Update transaction as failed
        await transactions.updateOne(
            { 
                $or: [
                    { reference: req.body.reference },
                    { korapayReference: req.body.reference }
                ]
            },
            {
                status: 'failed',
                updatedAt: new Date()
            }
        );

        console.error("PIN submission error:", {
            status: err.response?.status,
            data: err.response?.data,
            reference: req.body.reference
        });

        return res.status(statusCode).json({
            Error: true,
            Code: err.response?.data?.code || "PROCESSING_ERROR",
            Message: errorMessage
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
                authorization: {
                    otp: otp
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log("Korapay OTP response:", response.data);

        const responseData = response.data.data;
        const amount = responseData.amount / 100; // Convert to Naira

        // Update both transaction collections
        await transactions.updateOne(
            { 
                $or: [
                    { reference: reference },
                    { korapayReference: reference }
                ]
            },
            {
                status: 'success',
                updatedAt: new Date()
            },
            { session }
        );

        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": "success",
                    "transactions.$.updatedAt": new Date(),
                },
                $inc: {
                    balance: amount
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        return res.status(200).json({
            Error: false,
            Status: "success",
            Message: "Payment Successful",
            Data: {
                reference,
                amount: responseData.amount,
                currency: responseData.currency,
                balance: amount
            }
        });

    } catch (err) {
        await session.abortTransaction();
        
        const statusCode = err.response?.status || 500;
        const errorMessage = err.response?.data?.message || "OTP verification failed";
        
        // Update both collections as failed
        await transactions.updateOne(
            { 
                $or: [
                    { reference: req.body.reference },
                    { korapayReference: req.body.reference }
                ]
            },
            {
                status: 'failed',
                updatedAt: new Date()
            }
        );

        await walletModel.updateOne(
            { "transactions.reference": req.body.reference },
            {
                $set: {
                    "transactions.$.status": "failed",
                    "transactions.$.updatedAt": new Date()
                }
            }
        );

        console.error("OTP submission error:", {
            status: err.response?.status,
            data: err.response?.data,
            reference: req.body.reference
        });

        return res.status(statusCode).json({
            Error: true,
            Code: err.response?.data?.code || "VERIFICATION_FAILED",
            Message: errorMessage
        });
    } finally {
        session.endSession();
    }
};

const DepositWithVisualAccount = async (req, res) => {
    return res.status(501).json({ Error: true, Message: "Not implemented yet" });
};

module.exports = {
    DepositWithCard,
    submitCardPIN,
    submitCardOTP,
    DepositWithVisualAccount
};