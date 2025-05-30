const  axios = require("axios");
const { default: mongoose } = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const walletModel = require("../../model/walletModel");
const ErrorDisplay  = require('../../utils/random.util');
// const { encryptKorapayPayload } = require('../../utils/encryption.util');

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

        const reference = `SWIFTPAY-${uuidv4()}`;
        const payload = {
            amount: parseInt(amount),
            currency,
            reference,
            customer:{
                name: user.FirstName,
                email: user.Email,
                phone: user.Phone,
            },
            card: {
                number: card.number,
                cvv: card.cvv,
                expiry_month: card.expiry_month,
                expiry_year: card.expiry_year
            }
        };

        console.log("Payload:", JSON.stringify(payload, null, 2));
        // const encryptedPayload = encryptKorapayPayload(payload);
        const integrateCard = await axios.post(
            "https://api.korapay.com/merchant/api/v1/charges/card",payload,
            // {
            //     charge_data: payload
            // },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json"
                }
            }
        );
        // console.log("Korapay Payload:", JSON.stringify(payload, null, 2));

        const cardToSave = {
            number: card.number.slice(-4),
            expiry_month: card.expiry_month,
            expiry_year: card.expiry_year,
            authorization: integrateCard.data?.authorization || null
        };

        const updateData = {
            $push: {
                transactions: {
                    type: 'deposit',
                    amount,
                    method: 'card',
                    status: 'pending',
                    reference,
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


        const authData = integrateCard.data?.authorization;
        if (authData?.mode === "pin") {
            return res.status(200).json({
                Error: false,
                Message: "Card requires PIN",
                NextStep: "Enter card PIN",
                Reference: reference,
                Mode: "pin"
            });
        } else if (authData?.mode === "otp") {
            return res.status(200).json({
                Error: false,
                Message: "Card requires OTP",
                NextStep: "Enter OTP",
                Reference: reference,
                Mode: "otp"
            });
        } else if (authData?.mode === "redirect") { 
            if (!authData?.redirect_url) {
                throw new Error("Redirect URL missing from Korapay response");
            }
            
            return res.status(200).json({
                Error: false,
                Message: "Redirect to bank page required",
                RedirectURL: authData.redirect_url,
                Reference: reference,
                Mode: "redirect"
            });
        }

        await session.commitTransaction();
        return res.status(200).json({
            Error: false,
            Message: "pending payment",
            Data: {
                reference,
                status: "pending_verification"
            }
        });
        

    } catch (error) {
        await session.abortTransaction();
        // console.error("Error charging card:", error);
        console.error("Error Response:", error.response?.data);
        return res.status(400).json({
            Error: true,
            Message: ErrorDisplay(error).msg,
            Code: error.response?.data?.code || "PROCESSING_ERROR"
        });
    } finally {
        session.endSession();
    }

    console.log("Korapay API Secret:", process.env.kora_api_secret);
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
            "https://api.korapay.com/merchant/api/v1/charges/card/pin",
            { pin, reference },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json",
                },
            }
        );

        const nextAuth = response.data.data?.authorization;
        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": nextAuth ? "pending" : "success",
                    "transactions.$.updatedAt": new Date()
                }
            },
            { session }
        );

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
            Status: "success",
            Message: "Payment Successful",
            Data: {
                reference,
                amount: response.data.data?.amount,
                currency: response.data.data?.currency
            }
        });

    } catch (err) {
        await session.abortTransaction();
        const statusCode = err.response?.status || 500;
        const errorMessage = err.response?.data?.message || "PIN submission failed";
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
            "https://api.korapay.com/merchant/api/v1/charges/card/otp",
            { otp, reference },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json",
                },
            }
        );

        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": "success",
                    "transactions.$.updatedAt": new Date(),
                },
                $inc:{
                     balance: response.data.data?.amount || 0
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
                amount: response.data.data?.amount,
                currency: response.data.data?.currency,
                balance: response.data.data?.amount
            }
        });

    } catch (err) {
        const statusCode = err.response?.status || 500;
        const errorMessage = err.response?.data?.message || "OTP verification failed";
        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": "failed",
                    "transactions.$.updatedAt": new Date()
                }
            }
        );
        await session.abortTransaction();
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
    // Implementation for visual account deposits
    return res.status(501).json({ Error: true, Message: "Not implemented yet" });
};

module.exports = {
    DepositWithCard,
    submitCardPIN,
    submitCardOTP,
    DepositWithVisualAccount
};