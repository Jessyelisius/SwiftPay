const kycModel = require("../../model/kyc.Model");
const profileModel = require("../../model/profile.Model");
const userModel = require("../../model/userModel");
const { Sendmail } = require("../../utils/mailer.util");
const ErrorDisplay = require("../../utils/random.util");


const ApproveKYC = async(req, res) => {

    try {
        const userId = req.query.userId

        const user = await userModel.findById(userId);
        if (!user) {
        return res.status(404).json({ Error: true, Message: "User not found" });
        }
        const kyc = await kycModel.findOneAndUpdate({userid: userId}, {status: 'approved'}, {reasonForRejection:null});

        if(!kyc) return res.status(400).json({Error:true, Message:"Kyc not found"});

        await userModel.updateOne({_id: userId}, {isKycVerified:true});

        await profileModel.updateOne({user: userId}, {kycStatus:'approved'});

        await Sendmail(user.Email, "KYC Approved", 
           `
           <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8" />
            <title>KYC Approved</title>
            <style>
                body {
                font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
                }
                .email-wrapper {
                max-width: 600px;
                margin: 40px auto;
                background: #ffffff;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
                }
                .brand-logo {
                font-weight: bold;
                font-size: 24px;
                color: #d4af37;
                margin-bottom: 10px;
                }
                .divider {
                width: 100%;
                height: 4px;
                background-color: #6a0dad;
                margin-top: 5px;
                margin-bottom: 30px;
                }
                h2 {
                color: #222;
                font-size: 20px;
                }
                .footer {
                margin-top: 40px;
                font-size: 0.85rem;
                color: #777;
                text-align: center;
                }
                .footer-divider {
                width: 100%;
                height: 2px;
                background-color: #6a0dad;
                margin: 40px 0 10px;
                }
            </style>
            </head>
            <body>
            <div class="email-wrapper">
                <div class="brand-logo">SwiftPay</div>
                <div class="divider"></div>

                <h2>Congratulations, You're Verified!</h2>
                <p>Hi <strong>${user.FirstName}</strong>,</p>
                <p>Your KYC has been reviewed and approved successfully. You’re now fully verified and have access to the full SwiftPay experience.</p>

                <p>Start sending, receiving, and managing money with confidence.</p>

                <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #d4af37;">
                — The SwiftPay Team
                </p>

                <div class="footer-divider"></div>
                <div class="footer">
                © 2025 SwiftPay. All rights reserved.<br />
                Abuja, Nigeria
                </div>
            </div>
            </body>
            </html>

           `
        );
        res.status(200).json({ Error: false, Message: "KYC approved" });
    } catch (error) {
        console.log("Error approving KYC", error);
        return res.status(400).json({Error:true, Message:ErrorDisplay(error).msg});
    }
}


const RejectKYC = async(req, res) => {
    try {
        const userId = req.query.userId
       const { reason } = req.body;

       const user = await userModel.findById(userId);
       if (!user) {
       return res.status(404).json({ Error: true, Message: "User not found" });
       }
       const kyc = kycModel.findOneAndUpdate({userid: userId}, {status:'rejected'}, {reasonForRejection:reason});

       await userModel.updateOne({_id: userId}, {isKycVerified:false});

       if(!kyc) return res.status(400).json({Error:true, Message:"kyc not found"});
       
       await userModel.updateOne({_id: userId}, {isKycVerified:false});

       await profileModel.updateOne({user: userId}, {kycStatus:'rejected'});
       
       await Sendmail(user.Email, "KYC Rejected", 
        `
                <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8" />
        <title>KYC Rejected</title>
        <style>
        body {
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        background-color: #f5f5f5;
        margin: 0;
        padding: 0;
        }
        .email-wrapper {
        max-width: 600px;
        margin: 40px auto;
        background: #ffffff;
        padding: 40px;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        }
        .brand-logo {
        font-weight: bold;
        font-size: 24px;
        color: #d4af37;
        margin-bottom: 10px;
        }
        .divider {
        width: 100%;
        height: 4px;
        background-color: #6a0dad;
        margin-top: 5px;
        margin-bottom: 30px;
        }
        .reason-box {
        background-color: #ffe6e6;
        border-left: 4px solid #d9534f;
        padding: 15px;
        margin: 20px 0;
        font-weight: bold;
        color: #d9534f;
        }
        h2 {
        color: #222;
        font-size: 20px;
        }
        .footer {
        margin-top: 40px;
        font-size: 0.85rem;
        color: #777;
        text-align: center;
        }
        .footer-divider {
        width: 100%;
        height: 2px;
        background-color: #6a0dad;
        margin: 40px 0 10px;
        }
        </style>
        </head>
        <body>
        <div class="email-wrapper">
        <div class="brand-logo">SwiftPay</div>
        <div class="divider"></div>

        <h2>KYC Verification Rejected</h2>
        <p>Hi <strong>${user.FirstName}</strong>,</p>
        <p>Unfortunately, your KYC submission was not approved at this time.</p>

        <div class="reason-box">
        Reason: ${reason}
        </div>

        <p>You may review your details and resubmit your KYC from your SwiftPay dashboard.</p>

        <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #d4af37;">
        — The SwiftPay Compliance Team
        </p>

        <div class="footer-divider"></div>
        <div class="footer">
        © 2025 SwiftPay. All rights reserved.<br />
        Abuja, Nigeria
        </div>
        </div>
        </body>
        </html>

        `
       );

       return res.status(200).json({ Error: false, Message: "KYC rejected" });
    } catch (error) {
        console.log("Error rejecting KYC", error);
        return res.status(400).json({Error:true, Message:ErrorDisplay(error).msg});
    }
}


module.exports = {
    ApproveKYC,
    RejectKYC
}