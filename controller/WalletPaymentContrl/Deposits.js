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
        console.log(user);
        
        if (!user?.isKycVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "KYC not verified" });
        }
        if (!user?.isprofileVerified){
            await session.abortTransaction();
         return res.status(403).json({ Error: true, Message: "Profile not verified" });
        }

        //check if user has added card before, and display it
        if (req.query?.userSavedCard) {
            const saveCardDetails = await walletModel.findOne({ userId: user._id });
            if (!saveCardDetails?.userSavedCard  || saveCardDetails.userSavedCard.length === 0) {
                return res.status(404).json({ Error: true, Message: "No saved card found" });
            }
            const firstCard = saveCardDetails.userSavedCard[0];
            return res.status(200).json({
                hasCard: true,
                card: {
                    last4: firstCard.number,
                    expiry_month: firstCard.expiry_month,
                    expiry_year: firstCard.expiry_year
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

        // Fix: Create a unique reference that won't conflict with const declaration
        const originalReference = `SWIFTPAY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

        // Store amount in Naira in database
        const newTransaction = new transactions({
            userId: user._id,
            amount: amountInNaira, // Store in Naira, not kobo
            currency,
            method: 'card',
            type: 'deposit',
            status: 'pending',
            reference: originalReference
        });

        await newTransaction.save({ session });

        const payload = {
            amount: amountInKobo, // Send kobo to KoraPay
            currency,
            reference: originalReference,
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
        console.log('API Response:', JSON.stringify(integrateCard.data, null, 2));

        const chargeData = integrateCard.data?.data;
        const chargeStatus = chargeData?.status;
        
        // Fix: Get KoraPay reference from correct field - use let instead of const
        let korapayReference = chargeData?.transaction_reference || chargeData?.reference;
        
        // If no reference from KoraPay, keep our original reference
        if (!korapayReference) {
            console.log('No KoraPay reference found, using original reference');
            korapayReference = originalReference;
        }

        console.log('Original Reference:', originalReference);
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
        const transactionStatus = chargeStatus === 'success' ? 'success' : 'pending';

        const updateData = {
            $push: {
                transactions: {
                    type: 'deposit',
                    amount: amountInNaira, // Store in Naira
                    method: 'card',
                    status: transactionStatus,
                    reference: korapayReference, // Use korapayReference here
                    currency,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            }
        };

        // FIXED: Card Saving Logic with proper session handling
        console.log('=== CARD SAVING DEBUG ===');
        console.log('saveCard flag:', saveCard);
        console.log('chargeData exists:', !!chargeData);
        console.log('authorization exists:', !!chargeData?.authorization);
        console.log('charge status:', chargeStatus);

        if (saveCard && chargeData?.authorization) {
            try {
                console.log('Attempting to save card...');
                console.log('Authorization data:', JSON.stringify(chargeData.authorization, null, 2));
                
                // Get the existing wallet record first
                const walletRecord = await walletModel.findOne({ userId: user._id }).session(session);
                
                if (!walletRecord) {
                    console.log('No wallet record found for user');
                } else {
                    console.log('Current saved cards:', walletRecord.userSavedCard);

                    // Initialize userSavedCard array if it doesn't exist
                    if (!walletRecord.userSavedCard) {
                        walletRecord.userSavedCard = [];
                    }

                    // Check if card already exists using authorization signature
                    const cardExists = walletRecord.userSavedCard.some(saved =>
                        saved.authorization?.signature === chargeData.authorization?.signature
                    );

                    console.log('Card exists:', cardExists);
                    console.log('Current card count:', walletRecord.userSavedCard.length);

                    // Check if user has less than 3 saved cards and card doesn't exist
                    if (!cardExists && walletRecord.userSavedCard.length < 3) {
                        const cardToSave = {
                            number: card.number.slice(-4), // Store only last 4 digits
                            expiry_month: card.expiry_month,
                            expiry_year: card.expiry_year,
                            authorization: chargeData.authorization,
                            addedAt: new Date()
                        };

                        console.log('Card to save:', JSON.stringify(cardToSave, null, 2));

                        // FIXED: Add card saving to updateData instead of separate operation
                        // This ensures it's part of the same transaction
                        if (!updateData.$push) {
                            updateData.$push = {};
                        }
                        updateData.$push.userSavedCard = cardToSave;

                        console.log('Card will be saved with wallet update');
                    } else if (cardExists) {
                        console.log('Card already saved, skipping.');
                    } else {
                        console.log('User already has 3 saved cards.');
                    }
                }
            } catch (error) {
                console.error('Error preparing card save:', error);
                console.error('Error stack:', error.stack);
            }
        } else {
            console.log('Card not saved because:');
            console.log('- saveCard:', saveCard);
            console.log('- has authorization:', !!chargeData?.authorization);
            console.log('- charge status:', chargeStatus);
        }
        console.log('=== END CARD SAVING DEBUG ===');

        // FIXED: Single wallet update operation that includes both transaction and card (if applicable)
        console.log('Final updateData:', JSON.stringify(updateData, null, 2));
        await walletModel.updateOne({ userId: user._id }, updateData, { session });

        if (chargeStatus === 'success') {
            await newTransaction.updateOne({ status: 'success' }, { session });
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
        if (transaction && data.transaction_reference && transaction.korapayReference !== data.transaction_reference) {
            transaction.korapayReference = data.transaction_reference;
            await transaction.save({ session });
            finalReference = data.transaction_reference;
        }

        const status = data?.status;
        
        // FIXED: Only update transaction status, don't touch balance
        // Let webhook handle balance updates to avoid double processing
        const dbStatus = status === 'success' ? 'success' : 'pending';

        await transactions.updateOne(
            { $or: [{ reference }, { korapayReference: reference }] },
            {
                status: dbStatus,
                updatedAt: new Date()
            },
            { session }
        );

        // FIXED: Only update wallet transaction status, NOT balance
        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": dbStatus,
                    "transactions.$.updatedAt": new Date()
                }
                // REMOVED: Balance increment - webhook will handle this
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
            Message: status === 'success' ? "Payment Successful - Processing..." : "Processing payment...",
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

// FIXED: Same fix for OTP handler
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
        if (transaction && data.transaction_reference && transaction.korapayReference !== data.transaction_reference) {
            transaction.korapayReference = data.transaction_reference;
            await transaction.save({ session });
            finalReference = data.transaction_reference;
        }

        const status = data?.status;
        
        // FIXED: Only update transaction status
        const dbStatus = status === 'success' ? 'success' : 'pending';

        await transactions.updateOne(
            { $or: [{ reference }, { korapayReference: reference }] },
            {
                status: dbStatus,
                updatedAt: new Date()
            },
            { session }
        );

        // FIXED: Only update wallet transaction status, NOT balance
        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": dbStatus,
                    "transactions.$.updatedAt": new Date()
                }
                // REMOVED: Balance increment - webhook will handle this
            },
            { session }
        );

        await session.commitTransaction();

        return res.status(200).json({
            Error: false,
            Status: status,
            Message: status === 'success' ? "Payment Successful - Processing..." : "Processing payment...",
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

const DepositWithVisualAccount = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const user = req.user;
        console.log(user);

        // Validation checks
        if (!user?.isKycVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "KYC not verified" });
        }
        if (!user?.isprofileVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "Profile not verified" });
        }

        // Check if user already has a virtual account
        let existingVirtualAccount = await VirtualAccount.findOne({ userId: user._id }).session(session);
        
        if (existingVirtualAccount) {
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Message: "Virtual account already exists",
                Data: {
                    accountNumber: existingVirtualAccount.accountNumber,
                    accountName: existingVirtualAccount.accountName,
                    bankName: existingVirtualAccount.bankName,
                    bankCode: existingVirtualAccount.bankCode
                }
            });
        }

        // Prepare Korapay request data
        const korapayData = {
            account_name: `${user.FirstName} ${user.LastName}`,
            account_reference: `VBA_${user._id}_${Date.now()}`,
            permanent: true,
            bank_code: "035", // Default to Wema Bank, you can make this configurable
            customer: {
                name: `${user.firstName} ${user.lastName}`,
                email: user.email,
                phone: user.phoneNumber || ""
            },
            // Optional: Add metadata
            metadata: {
                userId: user._id.toString(),
                createdAt: new Date().toISOString()
            }
        };

        // Make request to Korapay API
        const korapayResponse = await fetch('https://api.korapay.com/merchant/api/v1/virtual-bank-account', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.KORAPAY_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(korapayData)
        });

        const korapayResult = await korapayResponse.json();

        if (!korapayResponse.ok || !korapayResult.status) {
            throw new Error(korapayResult.message || 'Failed to create virtual account');
        }

        // Save virtual account details to database
        const virtualAccount = new VirtualAccount({
            userId: user._id,
            accountNumber: korapayResult.data.account_number,
            accountName: korapayResult.data.account_name,
            bankName: korapayResult.data.bank_name,
            bankCode: korapayResult.data.bank_code,
            accountReference: korapayResult.data.account_reference,
            korapayAccountId: korapayResult.data.id,
            isActive: true,
            createdAt: new Date()
        });

        await virtualAccount.save({ session });

        // Update user record to indicate they have a virtual account
        await User.findByIdAndUpdate(
            user._id,
            { 
                $set: { 
                    hasVirtualAccount: true,
                    virtualAccountId: virtualAccount._id
                }
            },
            { session }
        );

        await session.commitTransaction();

        return res.status(201).json({
            Error: false,
            Message: "Virtual account created successfully",
            Data: {
                accountNumber: virtualAccount.accountNumber,
                accountName: virtualAccount.accountName,
                bankName: virtualAccount.bankName,
                bankCode: virtualAccount.bankCode,
                accountReference: virtualAccount.accountReference
            }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error creating virtual account:', error);
        
        return res.status(500).json({
            Error: true,
            Message: error.message || "Failed to create virtual account",
            Details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        await session.endSession();
    }
};


module.exports = {
    DepositWithCard,
    submitCardPIN,
    submitCardOTP,
    DepositWithVisualAccount
};