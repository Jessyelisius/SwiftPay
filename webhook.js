// const verifyWebhookSignature = require('../../utils/korapayWebhook.util');
const walletModel = require('./model/walletModel');
const mongoose = require('mongoose');
// utils/korapayWebhook.util.js
const crypto = require('crypto');
const { Sendmail } = require('./utils/mailer.util');

const verifyWebhookSignature = (payload, signature) => {
    const secret = process.env.korapay_webhook;
    const computedSignature = crypto
        .createHmac('sha512', secret)
        .update(payload)
        .digest('hex');
        
    return computedSignature === signature;
};

// module.exports = verifyWebhookSignature;
const handleKorapayWebhook = async (req, res) => {
  try {
      const signature = req.headers['x-korapay-signature'];
      const isValid = verifyWebhookSignature(JSON.stringify(req.body), signature);
      
      if (!isValid) {
          return res.status(401).json({ 
              Error: true,
              Message: "Invalid webhook signature" 
          });
      }

      const webhookData = req.body; // This is the main webhook object
      
      // Fix: Access event and data correctly
      if (webhookData.event === "charge.success") {
          await handleSuccessfulCharge(webhookData.data);
      } else if (webhookData.event === "charge.failed") {
          await handleFailedCharge(webhookData.data);
      } else {
          console.log(`Unhandled event type: ${webhookData.event}`);
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
      const amountInNaira = amount / 100; // Convert kobo to naira

      // Find the wallet and populate user details
      const wallet = await walletModel
          .findOne({ "transactions.reference": reference })
          .populate("userId", "Email FullName"); // Fix: match your schema fields

      if (!wallet) {
          console.log(`Wallet not found for reference: ${reference}`);
          throw new Error("Wallet not found");
      }

      const FirstName = wallet.userId.FullName?.split(" ")[0] || "Customer";
      const Email = wallet.userId.Email;
      const date = new Date().toLocaleString();

      // Update BOTH transaction collections
      // 1. Update main transactions collection
      await transactions.updateOne(
          { reference },
          { 
              status: 'success',
              updatedAt: new Date()
          },
          { session }
      );

      // 2. Update wallet transaction and balance
      await walletModel.updateOne(
          { "transactions.reference": reference },
          {
              $set: {
                  "transactions.$.status": "success",
                  "transactions.$.updatedAt": new Date()
              },
              $inc: { balance: amountInNaira } // Add naira amount
          },
          { session }
      );

      console.log(`Successfully processed: ${reference}, Amount: ₦${amountInNaira}`);

      // Send success email
      await Sendmail(Email, "SwiftPay Transaction Successful",
          `<!DOCTYPE html>
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
                <strong>Amount:</strong> ₦${amountInNaira.toFixed(2)}<br />
                <strong>Currency:</strong> ${currency}<br />
                <strong>Date:</strong> ${date}
              </p>
              <p>Thank you for using SwiftPay. If you need help, reach us at <a href="mailto:support@swiftpay.com">support@swiftpay.com</a>.</p>
              <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #4caf50;">— The SwiftPay Team</p>
              <div class="footer-divider"></div>
              <div class="footer">© 2025 SwiftPay. All rights reserved.<br />Abuja, Nigeria</div>
            </div>
          </body>
          </html>`
      );

      await session.commitTransaction();
  } catch (error) {
      await session.abortTransaction();
      console.error('HandleSuccessfulCharge error:', error);
      throw error;
  } finally {
      session.endSession();
  }
};


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