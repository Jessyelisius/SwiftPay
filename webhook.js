// const verifyWebhookSignature = require('../../utils/korapayWebhook.util');
const walletModel = require('../../model/walletModel');
const mongoose = require('mongoose');
// utils/korapayWebhook.util.js
const crypto = require('crypto');
const { Sendmail } = require('./utils/mailer.util');

const verifyWebhookSignature = (payload, signature) => {
    const secret = process.env.KORAPAY_WEBHOOK_SECRET;
    const computedSignature = crypto
        .createHmac('sha512', secret)
        .update(payload)
        .digest('hex');
        
    return computedSignature === signature;
};

// module.exports = verifyWebhookSignature;

const handleKorapayWebhook = async (req, res) => {
    try {
        // Verify webhook signature first
        const signature = req.headers['x-korapay-signature'];
        const isValid = verifyWebhookSignature(JSON.stringify(req.body), signature);
        
        if (!isValid) {
            return res.status(401).json({ 
                Error: true,
                Message: "Invalid webhook signature" 
            });
        }

        const event = req.body.event;
        // const data = req.body.data;

        // Handle different webhook events
        // switch (event) {
        //     case 'charge.success':
        //         await handleSuccessfulCharge(data);
        //         break;
                
        //     case 'charge.failure':
        //         await handleFailedCharge(data);
        //         break;
                
        //     case 'transfer.success':
        //         // Handle transfer success if needed
        //         break;
                
        //     default:
        //         console.log(`Unhandled event type: ${event}`);
        // }

        if (event.event === "charge.success") {
            await handleSuccessfulCharge(event.data);
          } else if (event.event === "charge.failed") {
            await handleFailedCharge(event.data);
          }else{
            console.log(`Unhandled event type: ${event}`);
          }
      
        return res.status(200).json({ received: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(400).json({ 
            Error: true,
            Message: "Webhook processing failed" 
        });
    }
};

// Handle successful charges
const handleSuccessfulCharge = async (data) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { reference, amount, currency } = data;

        // Find the wallet and populate user details
        const wallet = await walletModel
            .findOne({ "transactions.reference": reference })
            .populate("userId", "email fullName");

        if (!wallet) throw new Error("Wallet not found");

        const FirstName = wallet.userId.FullName?.split(" ")[0] || "Customer";
        const Email = wallet.userId.Email;
        const date = new Date().toLocaleString();

        // Update wallet balance and transaction status
        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": "success",
                    "transactions.$.updatedAt": new Date()
                },
                $inc: { balance: amount }
            },
            { session }
        );

        // Prepare and send success email
        await Sendmail(Email, "SwiftPay Transaction Successful",
            `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>SwiftPay Transaction Successful</title>
          <style>
            body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
            .email-wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); }
            .brand-logo { font-weight: bold; font-size: 24px; color: #4caf50; margin-bottom: 10px; }
            .divider { width: 100%; height: 4px; background-color: #000; margin-top: 5px; margin-bottom: 30px; }
            h2 { color: #222; font-size: 20px; }
            .success-badge { display: inline-block; background-color: #4caf50; color: #fff; font-weight: bold; padding: 10px 16px; border-radius: 6px; font-size: 16px; margin-top: 20px; margin-bottom: 20px; }
            .footer { margin-top: 40px; font-size: 0.85rem; color: #777; text-align: center; }
            .footer-divider { width: 100%; height: 2px; background-color: #000; margin: 40px 0 10px; }
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <div class="brand-logo">SwiftPay</div>
            <div class="divider"></div>

            <h2>Transaction Successful 🎉</h2>
            <p>Hi <strong>${FirstName}</strong>,</p>
            <p>Your recent deposit was successful.</p>

            <div class="success-badge">Transaction Complete</div>

            <p>
              <strong>Reference:</strong> ${reference}<br />
              <strong>Amount:</strong> ₦${(amount / 100).toFixed(2)}<br />
              <strong>Currency:</strong> ${currency}<br />
              <strong>Date:</strong> ${date}
            </p>

            <p>Thank you for using SwiftPay. If you need help, reach us at <a href="mailto:support@swiftpay.com">support@swiftpay.com</a>.</p>

            <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #4caf50;">
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
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

// Handle failed charges
const handleFailedCharge = async (data) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { reference, reason } = data;

        const wallet = await walletModel
        .findOne({ "transactions.reference": reference })
        .populate("userId", "email fullName");
            
            if (!wallet) throw new Error("Wallet not found");
            
            const FirstName = wallet.userId.FullName?.split(" ")[0] || "Customer";
            const Email = wallet.userId.Email;
            const date = wallet.createdAt = new Date().toLocaleString();
            

        // Update transaction status
        await walletModel.updateOne(
            { "transactions.reference": reference },
            {
                $set: {
                    "transactions.$.status": "failed",
                    "transactions.$.failureReason": reason,
                    "transactions.$.updatedAt": new Date()
                }
            },
            { session }
        );

        // Send failed transaction email
        const html = 

        await Sendmail(Email, "SwiftPay Transaction Failed", 
            `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <title>SwiftPay Transaction Failed</title>
              <style>
                body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
                .email-wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); }
                .brand-logo { font-weight: bold; font-size: 24px; color: #d4af37; margin-bottom: 10px; }
                .divider { width: 100%; height: 4px; background-color: #000; margin-top: 5px; margin-bottom: 30px; }
                h2 { color: #222; font-size: 20px; }
                .fail-badge { display: inline-block; background-color: #e53935; color: #fff; font-weight: bold; padding: 10px 16px; border-radius: 6px; font-size: 16px; margin-top: 20px; margin-bottom: 20px; }
                .footer { margin-top: 40px; font-size: 0.85rem; color: #777; text-align: center; }
                .footer-divider { width: 100%; height: 2px; background-color: #000; margin: 40px 0 10px; }
              </style>
            </head>
            <body>
              <div class="email-wrapper">
                <div class="brand-logo">SwiftPay</div>
                <div class="divider"></div>

                <h2>Transaction Failed 😞</h2>
                <p>Hi <strong>${FirstName}</strong>,</p>
                <p>Unfortunately, your recent transaction failed.</p>

                <div class="fail-badge">Transaction Failed</div>

                <p>
                  <strong>Reference:</strong> ${reference}<br />
                  <strong>Reason:</strong> ${reason}<br />
                  <strong>Date:</strong> ${date}
                </p>

                <p>Please try again or contact <a href="mailto:support@swiftpay.com">support@swiftpay.com</a> if you need assistance.</p>

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

        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};


module.exports = {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge
}