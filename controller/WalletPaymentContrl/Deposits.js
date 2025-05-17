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


        //show card details if user has card already store in db
        const saveCardDetails = await walletModel.findOne({userId: user._id});
        if(!saveCardDetails?.virtualAccount){
            return res.status(404).json({Error:true, Message:"No saved card found. Please add card details."});
        }else{
            return res.status(200).json({
                hasCard:true,
                card:{
                    number: card.number,
                    cvv: card.cvv,
                    expiry_month: card.expiry_month,
                    expiry_year: card.expiry_year
                }
            });
        }


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

            // When saving card details
        const cardToSave = {
            number: card.number.slice(-4), // Only store last 4 digits
            expiry_month: card.expiry_month,
            expiry_year: card.expiry_year,
            // Never store CVV!
            authorization: integrateCard.data.authorization // Store any token provided
        };

        //save initial 
        await walletModel.updateOne({userId: user._id},
            {
                virtualAccount: cardToSave,
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


// POST /api/card/pin
const submitCardPIN = async (req, res) => {
    const { pin, reference } = req.body;
  
    try {
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
  
      const nextAuth = response.data.data.authorization;
  
      if (nextAuth?.mode === "otp") {
        return res.status(200).json({
          Error: false,
          Message: "PIN accepted. OTP required.",
          NextStep: "Enter OTP",
          Reference: response.data.data.reference,
          Mode: "otp"
        });
      }
  
      return res.status(200).json({
        Error: false,
        Message: "Payment Successful or Redirect required",
        Data: response.data
      });
  
    } catch (err) {
      return res.status(500).json({ Error: true, Message: err.response?.data || "PIN submission failed" });
    }
  };

  
  // POST /api/card/otp
const submitCardOTP = async (req, res) => {
    const { otp, reference } = req.body;
  
    try {
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
  
      return res.status(200).json({
        Error: false,
        Message: "Payment Successful",
        Data: response.data
      });
  
    } catch (err) {
      return res.status(500).json({ Error: true, Message: err.response?.data || "OTP verification failed" });
    }
  };
  

const DepositWithVisualAccount = async(req, res) => {

}


module.exports ={
    DepositWithCard
}