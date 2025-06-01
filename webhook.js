const walletModel = require('./model/walletModel');
const transactions = require('./model/transactionModel');
const AdminTransaction = require('./model/admin/transactionModelAdmin');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Sendmail } = require('./utils/mailer.util');

const verifyWebhookSignature = (payload, signature) => {
    const secret = process.env.korapay_webhook;
    if (!secret) {
        console.error('Korapay webhook secret not configured');
        return false;
    }
    
    // Fix: Handle different signature formats
    const cleanSignature = signature?.replace('sha512=', '') || signature;
    
    const computedSignature = crypto
        .createHmac('sha512', secret)
        .update(payload)
        .digest('hex');
        
    return computedSignature === cleanSignature;
};

const handleKorapayWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-korapay-signature'];
        
        if (!signature) {
            console.log('Missing webhook signature');
            return res.status(401).json({ 
                Error: true,
                Message: "Missing webhook signature" 
            });
        }

        const rawBody = JSON.stringify(req.body);
        const isValid = verifyWebhookSignature(rawBody, signature);
        
        if (!isValid) {
            console.log('Invalid webhook signature');
            return res.status(401).json({ 
                Error: true,
                Message: "Invalid webhook signature" 
            });
        }

        const webhookData = req.body;
        console.log('Webhook received:', JSON.stringify(webhookData, null, 2));
        
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

const handleSuccessfulCharge = async (data) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { reference, amount, currency } = data;
        const amountInNaira = amount / 100;

        console.log(`Processing successful charge: ${reference}, Amount: ₦${amountInNaira}`);

        // Find the transaction using both reference fields
        const transaction = await transactions.findOne({
            $or: [
                { reference: reference },
                { korapayReference: reference }
            ]
        }).populate('userId', 'Email FullName FirstName');

        if (!transaction) {
            console.log(`Transaction not found for reference: ${reference}`);
            await session.abortTransaction();
            return;
        }

        // Check if transaction is already processed
        if (transaction.status === 'successful') {
            console.log(`Transaction ${reference} already processed successfully`);
            await session.commitTransaction();
            return;
        }

        // Update main transaction record - Fix: Use correct status
        await transactions.updateOne(
            { _id: transaction._id },
            { 
                status: 'successful',  // Changed from 'success' to 'successful'
                updatedAt: new Date()
            },
            { session }
        );

        // Find and update wallet transaction
        const walletUpdateResult = await walletModel.updateOne(
            { 
                userId: transaction.userId._id,
                $or: [
                    { "transactions.reference": reference },
                    { "transactions.reference": transaction.reference }
                ]
            },
            {
                $set: {
                    "transactions.$.status": "successful",  // Changed to match model
                    "transactions.$.updatedAt": new Date()
                },
                $inc: { balance: amountInNaira }
            },
            { session }
        );

        // If wallet transaction not found, create it
        if (walletUpdateResult.matchedCount === 0) {
            console.log(`Wallet transaction not found for reference: ${reference}, creating new entry`);
            
            await walletModel.updateOne(
                { userId: transaction.userId._id },
                {
                    $push: {
                        transactions: {
                            type: 'deposit',
                            amount: amountInNaira,
                            method: 'card',
                            status: 'successful',  // Changed to match model
                            reference: reference,
                            currency: currency || 'NGN',
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    },
                    $inc: { balance: amountInNaira }
                },
                { upsert: true, session }
            );
        }

        // Create admin transaction record
        const adminTransaction = new AdminTransaction({
            userId: transaction.userId._id,
            transactionId: transaction._id,
            type: 'deposit',
            method: 'card',
            amount: amountInNaira,
            currency: currency || 'NGN',
            status: 'successful',  // Changed to match model
            reference: reference,
            korapayReference: reference,
            description: `Card deposit - ${reference}`,
            metadata: {
                paymentGateway: 'korapay',
                originalAmount: amount,
                processedVia: 'webhook'
            }
        });

        await adminTransaction.save({ session });

        console.log(`Successfully processed: ${reference}, Amount: ₦${amountInNaira}`);

        // Send success email
        const user = transaction.userId;
        const FirstName = user.FirstName || user.FullName?.split(" ")[0] || "Customer";
        const Email = user.Email;
        const date = new Date().toLocaleString();

        try {
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
                      <strong>Currency:</strong> ${currency || 'NGN'}<br />
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
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            // Don't fail the transaction if email fails
        }

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
        const { reference, reason, amount, currency } = data;
        const amountInNaira = amount ? amount / 100 : 0;

        console.log(`Processing failed charge: ${reference}, Reason: ${reason}`);

        const transaction = await transactions.findOne({
            $or: [
                { reference: reference },
                { korapayReference: reference }
            ]
        }).populate('userId', 'Email FullName FirstName');
            
        if (!transaction) {
            console.log(`Transaction not found for failed charge: ${reference}`);
            await session.abortTransaction();
            return;
        }

        // Check if already processed as failed
        if (transaction.status === 'failed') {
            console.log(`Transaction ${reference} already marked as failed`);
            await session.commitTransaction();
            return;
        }

        // Update main transaction record
        await transactions.updateOne(
            { _id: transaction._id },
            { 
                status: 'failed',
                failureReason: reason,
                updatedAt: new Date()
            },
            { session }
        );

        // Update wallet transaction status
        await walletModel.updateOne(
            { 
                userId: transaction.userId._id,
                $or: [
                    { "transactions.reference": reference },
                    { "transactions.reference": transaction.reference }
                ]
            },
            {
                $set: {
                    "transactions.$.status": "failed",
                    "transactions.$.failureReason": reason,
                    "transactions.$.updatedAt": new Date()
                }
            },
            { session }
        );

        // Create admin transaction record for failed deposit
        const adminTransaction = new AdminTransaction({
            userId: transaction.userId._id,
            transactionId: transaction._id,
            type: 'deposit',
            method: 'card',
            amount: amountInNaira,
            currency: currency || 'NGN',
            status: 'failed',
            reference: reference,
            korapayReference: reference,
            description: `Failed card deposit - ${reference}`,
            failureReason: reason,
            metadata: {
                paymentGateway: 'korapay',
                originalAmount: amount || transaction.amount,
                processedVia: 'webhook',
                failureDetails: reason
            }
        });

        await adminTransaction.save({ session });

        // Send failure email
        const user = transaction.userId;
        const FirstName = user.FirstName || user.FullName?.split(" ")[0] || "Customer";
        const Email = user.Email;
        const date = new Date().toLocaleString();

        try {
            await Sendmail(Email, "SwiftPay Transaction Failed", 
                `<!DOCTYPE html>
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
                      <strong>Amount:</strong> ₦${amountInNaira.toFixed(2)}<br />
                      <strong>Reason:</strong> ${reason}<br />
                      <strong>Date:</strong> ${date}
                    </p>
                    <p>Please try again or contact <a href="mailto:support@swiftpay.com">support@swiftpay.com</a> if you need assistance.</p>
                    <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #d4af37;">— The SwiftPay Team</p>
                    <div class="footer-divider"></div>
                    <div class="footer">© 2025 SwiftPay. All rights reserved.<br />Abuja, Nigeria</div>
                  </div>
                </body>
                </html>`
            );
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            // Don't fail the transaction if email fails
        }

        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        console.error('HandleFailedCharge error:', error);
        throw error;
    } finally {
        session.endSession();
    }
};

module.exports = {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge
};