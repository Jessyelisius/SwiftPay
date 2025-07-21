const walletModel = require('./model/walletModel');
const transactions = require('./model/transactionModel');
const AdminTransaction = require('./model/admin/transactionModelAdmin');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Sendmail } = require('./utils/mailer.util');
const transactionModelAdmin = require('./model/admin/transactionModelAdmin');

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

// Utility function for delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Check if error is retryable
const isRetryableError = (error) => {
    return (
        error.code === 112 || // WriteConflict
        error.codeName === 'WriteConflict' ||
        error.errorLabels?.includes('TransientTransactionError') ||
        error.name === 'MongoServerError'
    );
};

// Retry wrapper function
const withRetry = async (operation, maxRetries = MAX_RETRIES) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            
            console.log(`Attempt ${attempt} failed:`, error.message);
            
            // Check if it's a retryable error
            if (isRetryableError(error) && attempt < maxRetries) {
                const delay = RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
                console.log(`Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delay);
                continue;
            }
            
            // If not retryable or max retries reached, throw the error
            throw error;
        }
    }
    
    throw lastError;
};

const handleKorapayWebhook = async (req, res) => {
    try {
        const korapaySecret = process.env.kora_api_secret;
        const korapaySignature = req.headers['x-korapay-signature'];

        if (!korapaySecret || !korapaySignature) {
            console.log('Missing webhook secret or signature');
            return res.status(400).json({ received: false, error: 'Missing signature' });
        }

        // ✅ Hash only the `data` field using SHA-256
        const payload = JSON.stringify(req.body.data);
        const computedSignature = crypto
            .createHmac('sha256', korapaySecret)
            .update(payload)
            .digest('hex');

        if (computedSignature !== korapaySignature) {
            console.log('Invalid webhook signature');
            return res.status(400).json({ received: false, error: 'Invalid signature' });
        }

        const webhookData = req.body;
        console.log('Webhook received:', JSON.stringify(webhookData, null, 2));
        
        // FIXED: Better idempotency check using transaction reference
        const transactionReference = webhookData.data?.reference || webhookData.data?.payment_reference;
        if (!transactionReference) {
            console.log('No transaction reference found in webhook');
            return res.status(400).json({ received: false, error: 'No transaction reference' });
        }

        // Check if this specific webhook event has already been processed
        const existingAdminTx = await AdminTransaction.findOne({
            $and: [
                {
                    $or: [
                        { reference: transactionReference },
                        { korapayReference: transactionReference }
                    ]
                },
                { 'metadata.webhookEvent': webhookData.event },
                { status: webhookData.event === 'charge.success' ? 'success' : 'failed' }
            ]
        });
        
        if (existingAdminTx) {
            console.log(`✅ Webhook event already processed: ${webhookData.event} for ${transactionReference}`);
            return res.status(200).json({ received: true, message: 'Already processed' });
        }
        
        // Process webhook with retry logic
        await withRetry(async () => {
            if (webhookData.event === "charge.success") {
                await handleSuccessfulCharge(webhookData.data, webhookData.event);
            } else if (webhookData.event === "charge.failed") {
                await handleFailedCharge(webhookData.data, webhookData.event);
            } else if (webhookData.event === "transfer.success") {
                await handleTransferSuccess(webhookData.data, webhookData.event);
            } else if (webhookData.event === "transfer.failed") {
                await handleTransferFailed(webhookData.data, webhookData.event);
            } else {
                console.log(`Unhandled event type: ${webhookData.event}`);
            }
        });
    
        return res.status(200).json({ received: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(400).json({ 
            Error: true,
            Message: "Webhook processing failed",
            Details: error.message 
        });
    }
};

// FIXED: Proper idempotency - check EVERYTHING at the start
const handleSuccessfulCharge = async (data, webhookEvent = null) => {
    const session = await mongoose.startSession();
    let webhookReference;
    
    try {
        await session.withTransaction(async () => {
            const { reference, payment_reference, amount, currency } = data;
            webhookReference = reference || payment_reference;
            
            console.log(`Processing successful charge: ${webhookReference}`);

            // Find the transaction
            const transaction = await transactions.findOne({
                $or: [
                    { reference: webhookReference },
                    { korapayReference: webhookReference }
                ]
            }).populate('userId', 'Email FirstName').session(session);

            if (!transaction) {
                console.log(`Transaction not found for reference: ${webhookReference}`);
                throw new Error(`Transaction not found: ${webhookReference}`);
            }

            const amountInNaira = transaction.amount;
            console.log(`Found transaction: ${transaction._id}, Amount: ₦${amountInNaira}, Current Status: ${transaction.status}`);

            // ✅ EARLY EXIT: Check if this exact webhook event was already processed
            const existingAdminTx = await AdminTransaction.findOne({
                $and: [
                    { transactionId: transaction._id },
                    { 'metadata.webhookEvent': webhookEvent },
                    { status: 'success' }
                ]
            }).session(session);

            if (existingAdminTx) {
                console.log(`⏭️ SKIPPING: Admin transaction already exists for webhook event: ${webhookEvent}`);
                return; // EXIT EARLY - don't do anything else
            }

            // ✅ Check if wallet already has this successful transaction
            const walletRecord = await walletModel.findOne({
                userId: transaction.userId._id
            }).session(session);

            const walletHasSuccessfulTx = walletRecord?.transactions?.some(tx => 
                (tx.reference === webhookReference || 
                 tx.reference === transaction.reference || 
                 tx.reference === transaction.korapayReference) && 
                tx.status === 'success'
            );

            const shouldUpdateWallet = !walletHasSuccessfulTx;
            const shouldUpdateTransaction = transaction.status !== 'success';
            
            console.log(`Wallet check - Has successful tx: ${walletHasSuccessfulTx}, Should update wallet: ${shouldUpdateWallet}`);
            
            // Update main transaction if not already successful
            if (shouldUpdateTransaction) {
                await transactions.updateOne(
                    { _id: transaction._id },
                    { 
                        status: 'success',
                        korapayReference: webhookReference,
                        updatedAt: new Date()
                    },
                    { session }
                );
                console.log(`Updated transaction ${transaction._id} status to success`);
            } else {
                console.log(`Transaction ${transaction._id} already successful - skipping status update`);
            }

            // ✅ Handle wallet operations - based on wallet state, not transaction state
            if (shouldUpdateWallet) {
                await handleWalletOperation(transaction, webhookReference, amountInNaira, currency, session);
                console.log(`Wallet operations completed - balance updated`);
            } else {
                console.log(`Skipping wallet operations - wallet already has successful transaction`);
            }

            // ✅ ALWAYS create admin transaction for webhook tracking (this is our idempotency key)
            await handleAdminTransaction(transaction, webhookReference, amountInNaira, currency, session, webhookEvent);

            console.log(`Successfully processed: ${webhookReference}, Amount: ₦${amountInNaira}`);

        }, {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary'
        });

        // Send email outside of transaction (only for first success)
        const finalTransaction = await transactions.findOne({
            $or: [
                { reference: webhookReference },
                { korapayReference: webhookReference }
            ]
        });
        
        if (finalTransaction && finalTransaction.status === 'success') {
            await sendSuccessEmail(data, webhookReference);
        }

    } catch (error) {
        console.error('HandleSuccessfulCharge error:', error);
        throw error;
    } finally {
        await session.endSession();
    }
};

// ✅ SIMPLIFIED: Remove the skipBalanceUpdate parameter - just do wallet ops
const handleWalletOperation = async (transaction, webhookReference, amountInNaira, currency, session) => {
    try {
        // Find or create wallet
        let walletRecord = await walletModel.findOne({
            userId: transaction.userId._id
        }).session(session);

        if (!walletRecord) {
            console.log(`Creating new wallet for user ${transaction.userId._id}`);
            await walletModel.create([{
                userId: transaction.userId._id,
                balance: amountInNaira,
                currency: currency || 'NGN',
                lastTransaction: transaction._id,
                transactions: [{
                    type: 'deposit',
                    amount: amountInNaira,
                    method: 'card',
                    status: 'success',
                    reference: webhookReference,
                    currency: currency || 'NGN',
                    createdAt: new Date(),
                    updatedAt: new Date()
                }]
            }], { session });
            console.log(`Created new wallet with balance: ₦${amountInNaira}`);
        } else {
            // Check if wallet transaction already exists
            const existingWalletTx = walletRecord.transactions?.find(tx => 
                tx.reference === webhookReference ||
                (tx.reference === transaction.reference || tx.reference === transaction.korapayReference)
            );

            if (existingWalletTx && existingWalletTx.status === 'success') {
                console.log(`Wallet transaction already successful: ${existingWalletTx.reference}`);
                return;
            }

            if (existingWalletTx) {
                // Update existing wallet transaction
                await walletModel.updateOne(
                    { 
                        userId: transaction.userId._id,
                        "transactions._id": existingWalletTx._id
                    },
                    {
                        $set: {
                            "transactions.$.status": "success",
                            "transactions.$.reference": webhookReference,
                            "transactions.$.updatedAt": new Date()
                        },
                        $inc: { balance: amountInNaira }
                    },
                    { session }
                );
                console.log(`Updated existing wallet transaction and incremented balance by: ₦${amountInNaira}`);
            } else {
                // Create new wallet transaction and increment balance
                await walletModel.updateOne(
                    { userId: transaction.userId._id },
                    {
                        $push: {
                            transactions: {
                                type: 'deposit',
                                amount: amountInNaira,
                                method: 'card',
                                status: 'success',
                                reference: webhookReference,
                                currency: currency || 'NGN',
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        $inc: { balance: amountInNaira },
                        lastTransaction: transaction._id
                    },
                    { session }
                );
                
                console.log(`Created new wallet transaction and incremented balance by: ₦${amountInNaira}`);
            }
        }

        // Log final balance
        const updatedWallet = await walletModel.findOne({
            userId: transaction.userId._id
        }).session(session);
        console.log(`💰 Final wallet balance for user ${transaction.userId._id}: ₦${updatedWallet.balance}`);
        
    } catch (error) {
        console.error('Wallet operation error:', error);
        throw error;
    }
};

// ✅ This creates the admin transaction (our idempotency key)
const handleAdminTransaction = async (transaction, webhookReference, amountInNaira, currency, session, webhookEvent = null) => {
    try {
        // Create admin transaction with webhook event tracking
        await AdminTransaction.create([{
            userId: transaction.userId._id,
            transactionId: transaction._id,
            type: 'deposit',
            method: 'card',
            amount: amountInNaira,
            currency: currency || 'NGN',
            status: 'success',
            reference: webhookReference,
            korapayReference: webhookReference,
            description: `Card deposit - ${webhookReference}`,
            metadata: {
                paymentGateway: 'korapay',
                originalAmount: amountInNaira * 100,
                processedVia: 'webhook',
                webhookProcessedAt: new Date(),
                webhookEvent: webhookEvent, // This is our idempotency key
                processingId: `${webhookEvent}-${webhookReference}-${Date.now()}` // Unique processing ID
            }
        }], { session });

        console.log(`Created admin transaction record for webhook event: ${webhookEvent}`);
    } catch (error) {
        console.error('Admin transaction error:', error);
        throw error;
    }
};

// Improved success email function
const sendSuccessEmail = async (data, webhookReference) => {
    try {
        const { amount, currency } = data;
        const amountInNaira = amount / 100;
        
        // Find transaction for email details
        const transaction = await transactions.findOne({
            $or: [
                { reference: webhookReference },
                { korapayReference: webhookReference }
            ]
        }).populate('userId', 'Email FullName FirstName');

        if (!transaction) {
            console.log('Transaction not found for email sending');
            return;
        }

        const user = transaction.userId;
        const FirstName = user.FirstName || "Customer";
        const Email = user.Email;
        const date = new Date().toLocaleString();

        console.log(`Sending email to: ${Email}`);

        await withRetry(async () => {
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
                    <h2>Transaction Successful!</h2>
                    <p>Hi <strong>${FirstName}</strong>,</p>
                    <p>Your recent deposit was successful.</p>
                    <div class="success-badge">Transaction Complete</div>
                    <p>
                      <strong>Reference:</strong> ${webhookReference}<br />
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
        });

        console.log(`Email sent successfully to ${Email}`);
    } catch (emailError) {
        console.error('Email sending failed:', emailError);
        // Don't fail the webhook if email fails
    }
};

// FIXED: Improved failed charge handler
const handleFailedCharge = async (data, webhookEvent = null) => {
    const session = await mongoose.startSession();
    
    try {
        await session.withTransaction(async () => {
            const { reference, reason, amount, currency } = data;
            const amountInNaira = amount ? amount / 100 : 0;

            console.log(`Processing failed charge: ${reference}, Reason: ${reason}`);

            const transaction = await transactions.findOne({
                $or: [
                    { reference: reference },
                    { korapayReference: reference }
                ]
            }).populate('userId', 'Email FullName FirstName').session(session);
                
            if (!transaction) {
                console.log(`Transaction not found for failed charge: ${reference}`);
                throw new Error(`Transaction not found: ${reference}`);
            }

            // ✅ EARLY EXIT: Check if this webhook event was already processed
            const existingAdminTx = await AdminTransaction.findOne({
                $and: [
                    { transactionId: transaction._id },
                    { 'metadata.webhookEvent': webhookEvent },
                    { status: 'failed' }
                ]
            }).session(session);

            if (existingAdminTx) {
                console.log(`⏭️ SKIPPING: Failed webhook already processed for: ${reference}`);
                return;
            }

            // Update main transaction if not already failed
            if (transaction.status !== 'failed') {
                await transactions.updateOne(
                    { _id: transaction._id },
                    { 
                        status: 'failed',
                        failureReason: reason,
                        updatedAt: new Date()
                    },
                    { session }
                );
                console.log(`✅ Updated transaction ${transaction._id} status to failed`);
            }

            // Update wallet transaction if exists
            await walletModel.updateOne(
                { 
                    userId: transaction.userId._id,
                    "transactions.reference": reference
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

            // Create admin transaction with improved metadata
            await AdminTransaction.create([{
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
                    failureDetails: reason,
                    webhookProcessedAt: new Date(),
                    webhookEvent: webhookEvent // Idempotency key
                }
            }], { session });

            console.log(`✅ Successfully processed failed charge: ${reference}`);
        }, {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary'
        });

        // Send failure email outside transaction
        await sendFailureEmail(data);

    } catch (error) {
        console.error('HandleFailedCharge error:', error);
        throw error;
    } finally {
        await session.endSession();
    }
};

// Improved failure email function
const sendFailureEmail = async (data) => {
    try {
        const { reference, reason, amount, currency } = data;
        const amountInNaira = amount ? amount / 100 : 0;
        
        const transaction = await transactions.findOne({
            $or: [
                { reference: reference },
                { korapayReference: reference }
            ]
        }).populate('userId', 'Email FullName FirstName');

        if (!transaction) return;

        const user = transaction.userId;
        const FirstName = user.FirstName || "Customer";
        const Email = user.Email;
        const date = new Date().toLocaleString();

        await withRetry(async () => {
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
                    <h2>Transaction Failed!</h2>
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
        });
    } catch (emailError) {
        console.error('Failure email sending failed:', emailError);
    }
};


///transfer secetion
const handleTransferSuccess = async(data, webhookEvent = null) => {
    const session = await mongoose.startSession();

    let webhookReference;

    try {
        await session.withTransaction(async() => {
            const { reference, amount, currency } = data;

            webhookReference = reference;

            console.log(`Processing transfer success: ${webhookReference}`);
            
            //find transaction
            const transaction = await transactions.findOne({
                $or: [
                    { reference: webhookReference },
                    { korapayReference: webhookReference }
                ]
            }).populate('userId', 'Email FirstName').session(session);

            if(!transaction) {
                console.log(`Transaction not found for reference: ${webhookReference}`);
                throw new Error(`Transaction not found: ${webhookReference}`);
            }

            //check if this webhook event was already processed
            const existingAdminTx = await AdminTransaction.findOne({
                $and: [
                    { transactionId: transaction._id },
                    { 'metadata.webhookEvent': webhookEvent },
                    { status: 'success' }
                ]
            }).session(session);

            if(existingAdminTx) {
                console.log(`⏭️ SKIPPING: Admin transaction already exists for webhook event: ${webhookEvent}`);
                return; // EXIT EARLY - don't do anything else
            }

            //update main transaction if not already successful
            if(transaction.status !== 'success') {
                await transactions.updateOne(
                    { _id: transaction._id },
                    { 
                        status: 'success',
                        korapayReference: webhookReference,
                        updatedAt: new Date()
                    },
                    { session }
                );
                console.log(`Updated transaction ${transaction._id} status to success`);
            }

            //update wallet transaction if exists
            await walletModel.updateOne(
                { 
                    userId: transaction.userId._id,
                    "transactions.reference": webhookReference
                },
                {
                    $set: {
                        "transactions.$.status": "success",
                        "transactions.$.updatedAt": new Date()
                    }
                },
                { session }
            );

            await transactionModelAdmin.create([{
                userId: transaction.userId._id,
                transactionId: transaction._id,
                type: 'transfer',
                method: 'bank_transfer',
                amount: amount,
                currency: currency || 'NGN',
                status: 'success',
                reference: webhookReference,
                korapayReference: webhookReference,
                description: `Bank transfer - ${webhookReference}`,
                metadata: {
                    paymentGateway: 'korapay',
                    originalAmount: amount * 100,
                    processedVia: 'webhook',
                    webhookProcessedAt: new Date(),
                    webhookEvent: webhookEvent, // Idempotency key
                    processingId: `${webhookEvent}-${webhookReference}-${Date.now()}`
                }
            }], { session });
            console.log(`Successfully processed transfer success: ${webhookReference}`);
        },
        {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary'
        });


         //find transaction for sending email
            const transaction = await transactions.findOne({
                $or: [
                    { reference: webhookReference },
                    { korapayReference: webhookReference }
                ]
            }).populate('userId', 'Email FirstName').session(session);

            if(!transaction) {
                console.log(`Transaction not found for reference: ${webhookReference}`);
                throw new Error(`Transaction not found: ${webhookReference}`);
            }

            const user = transaction.userId;
            const FirstName = user.FirstName || "Customer";
            const Email = user.Email;
            const Date = new Date().toLocaleString();

        await withRetry(async () => {
            // Send success email outside of transaction
            await Sendmail(Email, "SwiftPay Transfer Successful",
            `
            <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SwiftPay Transfer Receipt</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      color: #2c3e50;
      line-height: 1.6;
      padding: 20px 0;
    }
    
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #d4af37 0%, #f4d03f 100%);
      padding: 30px;
      text-align: center;
      position: relative;
    }
    
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><defs><pattern id="grain" width="100" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.5" fill="%23ffffff" opacity="0.1"/><circle cx="30" cy="15" r="0.3" fill="%23ffffff" opacity="0.05"/><circle cx="70" cy="5" r="0.4" fill="%23ffffff" opacity="0.08"/></pattern></defs><rect width="100" height="20" fill="url(%23grain)"/></svg>');
    }
    
    .brand {
      font-size: 32px;
      font-weight: 800;
      color: #ffffff;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
      letter-spacing: -1px;
      position: relative;
      z-index: 1;
    }
    
    .brand::after {
      content: 'TRANSFER RECEIPT';
      display: block;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 2px;
      margin-top: 5px;
      opacity: 0.9;
    }
    
    .content {
      padding: 40px 30px;
    }
    
    .greeting {
      font-size: 18px;
      color: #2c3e50;
      margin-bottom: 25px;
      font-weight: 500;
    }
    
    .greeting strong {
      color: #d4af37;
    }
    
    .success-badge {
      background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      margin-bottom: 30px;
      position: relative;
      overflow: hidden;
    }
    
    .success-badge::before {
      content: '✓';
      position: absolute;
      top: -10px;
      right: -10px;
      font-size: 60px;
      opacity: 0.1;
      font-weight: bold;
    }
    
    .success-text {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .success-amount {
      font-size: 28px;
      font-weight: 800;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .receipt-card {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 25px;
    }
    
    .section-header {
      background: linear-gradient(135deg, #34495e 0%, #2c3e50 100%);
      color: white;
      padding: 15px 20px;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    
    .section-content {
      padding: 20px;
    }
    
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #e9ecef;
    }
    
    .detail-row:last-child {
      border-bottom: none;
      font-weight: 600;
      background: rgba(212, 175, 55, 0.05);
      margin: 0 -20px -20px -20px;
      padding: 15px 20px;
    }
    
    .label {
      color: #6c757d;
      font-size: 14px;
      font-weight: 500;
    }
    
    .value {
      color: #2c3e50;
      font-weight: 600;
      text-align: right;
      max-width: 60%;
      word-break: break-word;
    }
    
    .amount-value {
      color: #d4af37;
      font-weight: 700;
      font-size: 16px;
    }
    
    .balance-value {
      color: #27ae60;
      font-weight: 700;
      font-size: 16px;
    }
    
    .reference-value {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      background: #e9ecef;
      padding: 4px 8px;
      border-radius: 4px;
    }
    
    .thank-you {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      color: #495057;
      font-weight: 500;
      margin-bottom: 30px;
    }
    
    .footer {
      background: #2c3e50;
      padding: 25px 30px;
      text-align: center;
      color: #bdc3c7;
    }
    
    .footer-brand {
      color: #d4af37;
      font-weight: 700;
      font-size: 18px;
      margin-bottom: 10px;
    }
    
    .footer-text {
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 15px;
    }
    
    .footer-link {
      color: #d4af37;
      text-decoration: none;
      font-weight: 600;
    }
    
    .footer-link:hover {
      text-decoration: underline;
    }
    
    .social-links {
      margin-top: 15px;
    }
    
    .social-link {
      display: inline-block;
      width: 32px;
      height: 32px;
      background: #34495e;
      border-radius: 50%;
      margin: 0 5px;
      line-height: 32px;
      text-align: center;
      color: #bdc3c7;
      text-decoration: none;
      font-size: 14px;
      transition: background-color 0.3s ease;
    }
    
    .social-link:hover {
      background: #d4af37;
      color: #2c3e50;
    }
    
    /* Mobile Responsive */
    @media (max-width: 600px) {
      body {
        padding: 10px 0;
      }
      
      .email-container {
        border-radius: 0;
        margin: 0;
      }
      
      .header, .content, .footer {
        padding: 25px 20px;
      }
      
      .brand {
        font-size: 28px;
      }
      
      .success-amount {
        font-size: 24px;
      }
      
      .detail-row {
        flex-direction: column;
        align-items: flex-start;
        padding: 10px 0;
      }
      
      .value {
        max-width: 100%;
        text-align: left;
        margin-top: 5px;
        font-weight: 700;
      }
      
      .section-content {
        padding: 15px;
      }
      
      .detail-row:last-child {
        margin: 0 -15px -15px -15px;
        padding: 12px 15px;
      }
    }
    
    @media (max-width: 480px) {
      .greeting {
        font-size: 16px;
      }
      
      .success-text {
        font-size: 14px;
      }
      
      .success-amount {
        font-size: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="brand">SwiftPay</div>
    </div>

    <div class="content">
      <div class="greeting">
        Hello <strong>${FirstName}</strong>,
      </div>

      <div class="success-badge">
        <div class="success-text">Transfer Completed Successfully</div>
        <div class="success-amount">₦${amount.toLocaleString()}</div>
      </div>

      <div class="receipt-card">
        <div class="section-header">Transaction Details</div>
        <div class="section-content">
          <div class="detail-row">
            <div class="label">Amount Sent</div>
            <div class="value amount-value">₦${amount.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction Fee</div>
            <div class="value">${fee > 0 ? `₦${fee.toLocaleString()}` : 'FREE'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Total Debited</div>
            <div class="value amount-value">₦${totalDeduction.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Current Balance</div>
            <div class="value balance-value">₦${(userWallet.balance).toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction ID</div>
            <div class="value reference-value">${reference}</div>
          </div>
          <div class="detail-row">
            <div class="label">Date & Time</div>
            <div class="value">${new Date().toLocaleString('en-GB', { 
              timeZone: 'Africa/Lagos',
              year: 'numeric',
              month: 'short',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })}</div>
          </div>
        </div>
      </div>

      <div class="receipt-card">
        <div class="section-header">Recipient Details</div>
        <div class="section-content">
          <div class="detail-row">
            <div class="label">Recipient Name</div>
            <div class="value">${recipient.accountName}</div>
          </div>
          <div class="detail-row">
            <div class="label">Account Number</div>
            <div class="value">${recipient.accountNumber}</div>
          </div>
          <div class="detail-row">
            <div class="label">Bank</div>
            <div class="value">${recipient.bankName}</div>
          </div>
          <div class="detail-row">
            <div class="label">Narration</div>
            <div class="value">${narration || 'SwiftPay Bank Transfer'}</div>
          </div>
        </div>
      </div>

      <div class="thank-you">
        Thank you for using SwiftPay. Keep this receipt for your records.
        ${fee === 0 ? '<br><strong>🎉 This was a FREE transfer!</strong>' : ''}
      </div>
    </div>

    <div class="footer">
      <div class="footer-brand">SwiftPay</div>
      <div class="footer-text">
        &copy; 2025 SwiftPay Financial Services. All rights reserved.<br />
        Abuja, Federal Capital Territory, Nigeria
      </div>
      <div class="footer-text">
        Need help? Contact us at <a href="mailto:support@swiftpay.com" class="footer-link">support@swiftpay.com</a><br />
        Or call: <a href="tel:+2348012345678" class="footer-link">+234 801 234 5678</a>
      </div>
      <div class="social-links">
        <a href="#" class="social-link">f</a>
        <a href="#" class="social-link">t</a>
        <a href="#" class="social-link">in</a>
        <a href="#" class="social-link">@</a>
      </div>
    </div>
  </div>
</body>
</html>
            `
            )
        });
    } catch (error) {
        console.error(`Error processing transfer success: ${webhookReference}`, error);
        throw error;
    }
}

const handleTransferFailed = async(data, webhookEvent = null) => {
    const session = await mongoose.startSession();

    let totalDeduction;
    try {
        await session.withTransaction(async() => {
              const { reference, reason, amount } = data;
              console.log(`Processing failed transfer: ${reference}, Reason: ${reason}`);

              // ✅ Calculate totalDeduction from transaction metadata
            totalDeduction = transaction.metadata?.totalDeduction || 
                    (amount + (transaction.metadata?.fee || 0));
              // Find transaction
              const transaction = await transactions.findOne({
                  $or: [
                      { reference: reference },
                      { korapayReference: reference }
                  ]
              }).populate('userId', 'Email FirstName').session(session);

              if (!transaction) {
                  console.log(`Transaction not found for failed transfer: ${reference}`);
                  throw new Error(`Transaction not found: ${reference}`);
              }

              // Check if this webhook event was already processed
              const existingAdminTx = await AdminTransaction.findOne({
                    $and: [
                        { transactionId: transaction._id },
                        { 'metadata.webhookEvent': webhookEvent },
                        { status: 'failed' }
                    ]
                }).session(session);

                if (existingAdminTx) {
                    console.log(`⏭️ SKIPPING: Failed transfer webhook already processed for: ${reference}`);
                    return; // EXIT EARLY - don't do anything else
                }

                // Update main transaction if not already failed
                if (transaction.status !== 'failed') {
                    await transactions.updateOne(
                        { _id: transaction._id },
                        { 
                            status: 'failed',
                            failureReason: reason,
                            updatedAt: new Date()
                        },
                        { session }
                    );
                    console.log(`✅ Updated transaction ${transaction._id} status to failed`);
                }

                // Refund the wallet balance (reverse the deduction)
                console.log(`Processing failed transfer: ${reference}, Reason: ${reason}`);

                await walletModel.updateOne(
                    {userId: transaction.userId._id},
                    {
                        $inc: { balance: totalDeduction },// Refund the wallet balance (reverse the deduction)
                        $push: {
                            transactions: {
                                reference: `refund- ${transaction.reference}`,
                                type: 'refund',
                                amount: amount,
                                status: 'success',
                                currency: 'NGN',
                                method: 'bank_transfer',
                                narration: `Refund for failed transfer - ${reference}`,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                                // description: `Refund for failed transfer - ${reference}`
                            }
                        }
                    },
                    { session }

                );

                // Update original wallet transaction status
                await walletModel.updateOne(
                    { 
                        userId: transaction.userId._id,
                        "transactions.reference": reference
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

                // Create admin transaction with improved metadata
                await AdminTransaction.create([{
                    userId: transaction.userId._id,
                    transactionId: transaction._id,
                    type: 'transfer',
                    method: 'bank_transfer',
                    amount: transaction.amount,
                    currency: 'NGN',
                    status: 'failed',
                    reference: reference,
                    korapayReference: reference,
                    description: `Failed bank transfer - ${reference}`,
                    failureReason: reason,
                    metadata: {
                        paymentGateway: 'korapay',
                        refundProcessed: true,
                        refundAmount: totalDeduction,
                        processedVia: 'webhook',
                        failureDetails: reason,
                        webhookProcessedAt: new Date(),
                        webhookEvent: webhookEvent // Idempotency key
                    }
                }], { session });

                console.log(`✅ Successfully processed failed transfer: ${reference}`);
        }, {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary'

        });

        // Send failure email outside transaction

        //find transaction for sending email
            const transaction = await transactions.findOne({
                $or: [
                    { reference: webhookReference },
                    { korapayReference: webhookReference }
                ]
            }).populate('userId', 'Email FirstName').session(session);

            if(!transaction) {
                console.log(`Transaction not found for reference: ${webhookReference}`);
                throw new Error(`Transaction not found: ${webhookReference}`);
            }

            const user = transaction.userId;
            const FirstName = user.FirstName || "Customer";
            const Email = user.Email;
            const Date = new Date().toLocaleString();

            await withRetry(async () => {
            await Sendmail(Email, "SwiftPay Transfer Failed",
                `
                <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SwiftPay Transfer Failed</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      color: #2c3e50;
      line-height: 1.6;
      padding: 20px 0;
    }
    
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    .content {
      padding: 40px 30px;
    }
    
    .brand {
      font-size: 24px;
      font-weight: bold;
      color: #d4af37;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
    }
    
    .title {
      font-size: 20px;
      font-weight: bold;
      margin-top: 25px;
      margin-bottom: 10px;
      color: #000;
    }
    
    .greeting {
      font-size: 18px;
      color: #2c3e50;
      margin-bottom: 25px;
      font-weight: 500;
    }
    
    .greeting strong {
      color: #d4af37;
    }
    
    .failed-badge {
      background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      margin-bottom: 30px;
      position: relative;
      overflow: hidden;
    }
    
    .failed-badge::before {
      content: '✗';
      position: absolute;
      top: -10px;
      right: -10px;
      font-size: 60px;
      opacity: 0.1;
      font-weight: bold;
    }
    
    .failed-text {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .failed-amount {
      font-size: 28px;
      font-weight: 800;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .reason-card {
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 25px;
      border-left: 4px solid #f39c12;
    }
    
    .reason-title {
      font-weight: 600;
      color: #856404;
      margin-bottom: 8px;
      font-size: 16px;
    }
    
    .reason-text {
      color: #856404;
      font-size: 14px;
      line-height: 1.5;
    }
    
    .receipt-card {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 25px;
    }
    
    .section-header {
      background: linear-gradient(135deg, #34495e 0%, #2c3e50 100%);
      color: white;
      padding: 15px 20px;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    
    .section-content {
      padding: 20px;
    }
    
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #e9ecef;
    }
    
    .detail-row:last-child {
      border-bottom: none;
      font-weight: 600;
      background: rgba(212, 175, 55, 0.05);
      margin: 0 -20px -20px -20px;
      padding: 15px 20px;
    }
    
    .label {
      color: #6c757d;
      font-size: 14px;
      font-weight: 500;
    }
    
    .value {
      color: #2c3e50;
      font-weight: 600;
      text-align: right;
      max-width: 60%;
      word-break: break-word;
    }
    
    .amount-value {
      color: #d4af37;
      font-weight: 700;
      font-size: 16px;
    }
    
    .balance-value {
      color: #27ae60;
      font-weight: 700;
      font-size: 16px;
    }
    
    .reference-value {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      background: #e9ecef;
      padding: 4px 8px;
      border-radius: 4px;
    }
    
    .status-failed {
      color: #e74c3c;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 14px;
    }
    
    .refund-notice {
      background: linear-gradient(135deg, #d5f4e6 0%, #c3f0ca 100%);
      border: 1px solid #27ae60;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 25px;
      text-align: center;
    }
    
    .refund-title {
      color: #27ae60;
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 8px;
    }
    
    .refund-text {
      color: #155724;
      font-size: 14px;
      line-height: 1.5;
    }
    
    .next-steps {
      background: #e3f2fd;
      border: 1px solid #bbdefb;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 25px;
    }
    
    .next-steps-title {
      color: #1565c0;
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 15px;
    }
    
    .steps-list {
      color: #1565c0;
      font-size: 14px;
      line-height: 1.6;
      margin-left: 0;
      padding-left: 0;
      list-style: none;
    }
    
    .steps-list li {
      margin-bottom: 8px;
      padding-left: 20px;
      position: relative;
    }
    
    .steps-list li::before {
      content: '•';
      color: #1565c0;
      font-weight: bold;
      position: absolute;
      left: 0;
    }
    
    .support-info {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      color: #495057;
      font-weight: 500;
      margin-bottom: 30px;
    }
    
    .support-title {
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    
    .support-link {
      color: #d4af37;
      text-decoration: none;
      font-weight: 600;
    }
    
    .footer {
      font-size: 13px;
      color: #888;
      text-align: center;
      border-top: 1px solid #000;
      padding-top: 20px;
      margin-top: 40px;
    }
    
    .footer a {
      color: #d4af37;
      text-decoration: none;
    }
    
    /* Mobile Responsive */
    @media (max-width: 600px) {
      body {
        padding: 10px 0;
      }
      
      .email-container {
        border-radius: 0;
        margin: 0;
      }
      
      .content, .footer {
        padding: 25px 20px;
      }
      
      .brand {
        font-size: 20px;
      }
      
      .failed-amount {
        font-size: 24px;
      }
      
      .detail-row {
        flex-direction: column;
        align-items: flex-start;
        padding: 10px 0;
      }
      
      .value {
        max-width: 100%;
        text-align: left;
        margin-top: 5px;
        font-weight: 700;
      }
      
      .section-content {
        padding: 15px;
      }
      
      .detail-row:last-child {
        margin: 0 -15px -15px -15px;
        padding: 12px 15px;
      }
      
      .reason-card, .refund-notice, .next-steps, .support-info {
        padding: 15px;
      }
    }
    
    @media (max-width: 480px) {
      .greeting {
        font-size: 16px;
      }
      
      .failed-text {
        font-size: 14px;
      }
      
      .failed-amount {
        font-size: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="content">
      <div class="brand">SwiftPay</div>
      <div class="title">Bank Transfer Failed</div>

      <div class="greeting">
        Hello <strong>${FirstName}</strong>,
      </div>

      <div class="failed-badge">
        <div class="failed-text">Transfer Failed</div>
        <div class="failed-amount">₦${amount.toLocaleString()}</div>
      </div>

      <div class="reason-card">
        <div class="reason-title">Reason for Failure</div>
        <div class="reason-text">${failureReason || 'The transfer could not be completed due to a technical issue. Please try again or contact support if the problem persists.'}</div>
      </div>

      <div class="refund-notice">
        <div class="refund-title">✓ Funds Automatically Refunded</div>
        <div class="refund-text">Don't worry! The full amount including any fees has been automatically refunded to your SwiftPay wallet.</div>
      </div>

      <div class="receipt-card">
        <div class="section-header">Transaction Details</div>
        <div class="section-content">
          <div class="detail-row">
            <div class="label">Attempted Amount</div>
            <div class="value amount-value">₦${amount.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction Fee</div>
            <div class="value">${fee > 0 ? `₦${fee.toLocaleString()}` : 'FREE'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Amount Refunded</div>
            <div class="value amount-value">₦${totalDeduction.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Current Balance</div>
            <div class="value balance-value">₦${(userWallet.balance).toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction ID</div>
            <div class="value reference-value">${reference}</div>
          </div>
          <div class="detail-row">
            <div class="label">Status</div>
            <div class="value status-failed">Failed</div>
          </div>
          <div class="detail-row">
            <div class="label">Date & Time</div>
            <div class="value">${new Date().toLocaleString('en-GB', { 
              timeZone: 'Africa/Lagos',
              year: 'numeric',
              month: 'short',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })}</div>
          </div>
        </div>
      </div>

      <div class="receipt-card">
        <div class="section-header">Intended Recipient</div>
        <div class="section-content">
          <div class="detail-row">
            <div class="label">Recipient Name</div>
            <div class="value">${recipient.accountName}</div>
          </div>
          <div class="detail-row">
            <div class="label">Account Number</div>
            <div class="value">${recipient.accountNumber}</div>
          </div>
          <div class="detail-row">
            <div class="label">Bank</div>
            <div class="value">${recipient.bankName}</div>
          </div>
          <div class="detail-row">
            <div class="label">Narration</div>
            <div class="value">${narration || 'SwiftPay Bank Transfer'}</div>
          </div>
        </div>
      </div>

      <div class="next-steps">
        <div class="next-steps-title">What to do next:</div>
        <ul class="steps-list">
          <li>Verify the recipient's account details are correct</li>
          <li>Check if the recipient's bank is currently available</li>
          <li>Ensure you have sufficient balance for the transfer</li>
          <li>Try the transfer again in a few minutes</li>
          <li>Contact our support team if the issue persists</li>
        </ul>
      </div>

      <div class="support-info">
        <div class="support-title">Need Help?</div>
        <div>Our support team is here to assist you.<br/>
        Contact us at <a href="mailto:support@swiftpay.com" class="support-link">support@swiftpay.com</a><br/>
        Or call: <a href="tel:+2348012345678" class="support-link">+234 801 234 5678</a></div>
      </div>
    </div>

    <div class="footer">
      &copy; 2025 SwiftPay. All rights reserved. Abuja, Nigeria<br />
      Need help? Contact <a href="mailto:support@swiftpay.com">support@swiftpay.com</a>
    </div>
  </div>
</body>
</html>
                `
            )
        });
    } catch (error) {
        console.error(`Failed to send email for transaction: ${webhookReference}`, error);
        throw error;
    }
}

module.exports = {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge,
    withRetry,
    handleTransferSuccess,
    handleTransferFailed,
    // verifyWebhookSignature
};