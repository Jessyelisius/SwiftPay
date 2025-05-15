const { default: axios } = require("axios");
const { default: mongoose } = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const walletModel = require("../../model/walletModel");
const {ErrorDisplay} = require('../../utils/random.util')

const DepositWithCard = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = req.user;
        if(!user.isKycVerified) return res.status(403).json({Error:true, Message:"KYC not verified"});

        if(!user?.isprofileVerified) return res.status(403).json({Error:true, Message:"Profile not verified"});

        const {amount, currency, card } = req.body;
        if(!amount || !card?.number || !card.expiry_month || !card?.expiry_year || !card?.cvv || !currency) return res.status(400).json({Error:true, Message:"Invalid card details"});

        const reference = `SWIFTPAY-${uuidv4()}`;
        
        const integrateCard = await axios.post(
            "https://api.korapay.com/merchant/api/v1/charges/card",
            {
                amount,
                currency,
                reference,
                email: user.Email,
                phone: user.Phone,
                card: {
                    number: card.number,
                    cvv: card.cvv,
                    expiry_month: card.expiry_month,
                    expiry_year: card.expiry_year
                },
                // redirect_url: `${process.env.BASE_URL}/api/v1/WalletPayment/verifyCard`
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.kora_api_secret}`,
                    "Content-Type": "application/json"
                }
            }
        );
        //save initial 
        await walletModel.updateOne({userId: user._id},
            {
                $push:{
                    transactions:{
                        type:'deposit',
                        amount,
                        method:'card',
                        status:'pending',
                        reference,
                        currency
                    }
                }
            },
            {session}
        );

        const authData = integrateCard.data.data.authorization;

        if(authData?.mode === "pin") {
            return res.status(200).json({
                Error: false,
                Message: "Card requires PIN",
                NextStep: "Enter card PIN",
                Reference: integrateCard.data.data.reference,
                Mode: "pin"
            });
        } else if(authData?.mode === "otp") {
            return res.status(200).json({
                Error: false,
                Message: "Card requires OTP",
                NextStep: "Enter OTP",
                Reference: integrateCard.data.data.reference,
                Mode: "otp"
            });
        } else if(authData?.mode === "redirect") {
            return res.status(200).json({
                Error: false,
                Message: "Redirect to bank page required",
                RedirectURL: authData.redirect_url,
                Reference: integrateCard.data.data.reference,
                Mode: "redirect"
            });
        }

        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({ Error: false, Message: "Card initiated, Await OTP or redirect to complete", Data: integrateCard.data });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Card deposit error:", error);
        return res.status(400).json({ Error: true, Message: ErrorDisplay(error).msg});
    }
}



const DepositWithVisualAccount = async(req, res) => {

}


module.exports ={
    DepositWithCard
}