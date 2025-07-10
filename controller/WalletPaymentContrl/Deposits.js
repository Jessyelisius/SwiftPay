const axios = require("axios");
const { default: mongoose } = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const walletModel = require("../../model/walletModel");
const ErrorDisplay = require('../../utils/random.util');
const encryptKorapayPayload = require('../../utils/encryption.util');
const transactions = require('../../model/transactionModel');
const VirtualAccount = require("../../model/virtualAccount.Model");
const userModel = require("../../model/userModel");

/**
 * Saves user card details to wallet after successful payment
 * @param {ObjectId} userId - User's MongoDB ID
 * @param {Object} cardData - Card data from request (contains full card info)
 * @param {Object} authorization - Full authorization object from KoraPay
 * @param {ClientSession} session - MongoDB session for transaction safety
 */
const saveUserCard = async (userId, cardData, authorization, session) => {
    try {
        console.log('=== SAVE CARD DEBUG ===');
        console.log('UserId:', userId);
        console.log('CardData:', cardData);
        console.log('Authorization:', authorization);
        
        // Get the wallet
        const wallet = await walletModel.findOne({ userId }).session(session);
        if (!wallet) {
            console.log('Wallet not found for userId:', userId);
            return { success: false, message: 'Wallet not found' }; // Fixed typo
        }
        
        console.log('Wallet found, current saved cards:', wallet.userSavedCard?.length || 0);

        // Initialize array if doesn't exist
        if (!wallet.userSavedCard) {
            wallet.userSavedCard = [];
            console.log('✅ Initialized userSavedCard array');
        }

        // Check if card already exists (using authorization signature or last4 + expiry)
        const last4 = cardData.number.slice(-4);
        console.log('Card last4:', last4);
        
        const existingCardIndex = wallet.userSavedCard.findIndex(card => {
            if (authorization?.signature && card.authorization?.signature) {
                return card.authorization.signature === authorization.signature;
            }
            // Fallback: check by last4 + expiry
            return card.number === last4 && 
                   card.expiry_month === cardData.expiry_month && 
                   card.expiry_year === cardData.expiry_year;
        });

        console.log('Existing card index:', existingCardIndex);

        // Check card limit before adding
        if (existingCardIndex === -1 && wallet.userSavedCard.length >= 3) {
            console.log('Card limit reached (max 3 cards)');
            return { success: false, message: 'Card limit reached (max 3 cards)' };
        }

        // Prepare card data (only store last4 digits for security)
        const cardToSave = {
            number: last4, // Store only last 4 digits
            expiry_month: cardData.expiry_month,
            expiry_year: cardData.expiry_year,
            authorization: authorization || {}, // Store authorization data (make it optional)
            addedAt: new Date()
        };

        console.log('Card to save:', cardToSave);

        // Update or add new card
        if (existingCardIndex >= 0) {
            // Update existing card
            wallet.userSavedCard[existingCardIndex] = cardToSave;
            console.log('✅ Updated existing card at index:', existingCardIndex);
        } else {
            // Add new card
            wallet.userSavedCard.push(cardToSave);
            console.log('✅ Added new card, total cards now:', wallet.userSavedCard.length);
        }

        // Mark the array as modified (important for nested objects in Mongoose)
        wallet.markModified('userSavedCard');
        
        // Save changes
        const savedWallet = await wallet.save({ session });
        console.log('✅ Wallet saved successfully');
        console.log('Final saved cards count:', savedWallet.userSavedCard.length);

        return { 
            success: true, 
            message: existingCardIndex >= 0 ? 'Card updated successfully' : 'Card added successfully',
            cardCount: savedWallet.userSavedCard.length
        };

    } catch (error) {
        console.error('❌ Card saving failed:', error);
        return { success: false, message: error.message };
    }
};

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

        // Update wallet with transaction
        await walletModel.updateOne({ userId: user._id }, updateData, { session });

        // SAVE CARD LOGIC - This runs regardless of transaction status
        let cardSaved = false;
        let cardSaveMessage = '';
        
        if (saveCard === true) {
            console.log('🔄 Attempting to save card details...');
            const saveResult = await saveUserCard(
                user._id, 
                card, // Original card data from request
                chargeData?.authorization, // Authorization from KoraPay
                session
            );
            
            cardSaved = saveResult.success;
            cardSaveMessage = saveResult.message;
            
            if (!cardSaved) {
                console.log('⚠️ Card save failed:', cardSaveMessage);
            } else {
                console.log('✅ Card saved successfully:', cardSaveMessage);
            }
        }

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
                    currency,
                    cardSaved: cardSaved,
                    cardSaveMessage: cardSaveMessage
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
            Mode: authMode || "verification",
            cardSaved: cardSaved,
            cardSaveMessage: cardSaveMessage
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
                name: `${user.FirstName} ${user.LastName}`,
                email: user.Email,
                phone: user.Phone || ""
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
                'Authorization': `Bearer ${process.env.kora_api_secret}`,
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
        // await userModel.findByIdAndUpdate(
        //     user._id,
        //     { 
        //         $set: { 
        //             hasVirtualAccount: true,
        //             virtualAccountId: virtualAccount._id
        //         }
        //     },
        //     { session }
        // );

        await walletModel.findByIdAndUpdate(
            {userId: user._id},
            {
                $set:{
                    hasVirtualAccount: true,
                    virtualAccount: virtualAccount._id
                }
            },
            {session}

        );

        // await walletModel.findOneAndUpdate(
        // { userId: user._id },
        // {
        //     $set: {
        //     hasVirtualAccount: true,
        //     virtualAccount: {
        //         accountNumber: virtualAccount.accountNumber,
        //         accountName: virtualAccount.accountName,
        //         bankName: virtualAccount.bankName,
        //         bankCode: virtualAccount.bankCode,
        //         accountReference: virtualAccount.accountReference,
        //         korapayAccountId: virtualAccount.korapayAccountId
        //     }
        //     }
        // },
        // { session }
        // );

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
    DepositWithVisualAccount,
    saveUserCard
};