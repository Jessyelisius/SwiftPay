const walletModel = require('./model/walletModel');
const transactions = require('./model/transactionModel');
const AdminTransaction = require('./model/admin/transactionModelAdmin');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Sendmail } = require('./utils/mailer.util');

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
            }).populate('userId', 'Email FullName FirstName').session(session);

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
            
            console.log(`🔍 Wallet check - Has successful tx: ${walletHasSuccessfulTx}, Should update wallet: ${shouldUpdateWallet}`);
            
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
                console.log(`✅ Updated transaction ${transaction._id} status to success`);
            } else {
                console.log(`⏭️ Transaction ${transaction._id} already successful - skipping status update`);
            }

            // ✅ Handle wallet operations - based on wallet state, not transaction state
            if (shouldUpdateWallet) {
                await handleWalletOperation(transaction, webhookReference, amountInNaira, currency, session);
                console.log(`✅ Wallet operations completed - balance updated`);
            } else {
                console.log(`⏭️ Skipping wallet operations - wallet already has successful transaction`);
            }

            // ✅ ALWAYS create admin transaction for webhook tracking (this is our idempotency key)
            await handleAdminTransaction(transaction, webhookReference, amountInNaira, currency, session, webhookEvent);

            console.log(`✅ Successfully processed: ${webhookReference}, Amount: ₦${amountInNaira}`);

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
            console.log(`✅ Created new wallet with balance: ₦${amountInNaira}`);
        } else {
            // Check if wallet transaction already exists
            const existingWalletTx = walletRecord.transactions?.find(tx => 
                tx.reference === webhookReference ||
                (tx.reference === transaction.reference || tx.reference === transaction.korapayReference)
            );

            if (existingWalletTx && existingWalletTx.status === 'success') {
                console.log(`⚠️ Wallet transaction already successful: ${existingWalletTx.reference}`);
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
                console.log(`✅ Updated existing wallet transaction and incremented balance by: ₦${amountInNaira}`);
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
                console.log(`✅ Created new wallet transaction and incremented balance by: ₦${amountInNaira}`);
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

        console.log(`✅ Created admin transaction record for webhook event: ${webhookEvent}`);
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
        const FirstName = user.FirstName || user.FullName?.split(" ")[0] || "Customer";
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
                    <h2>Transaction Successful 🎉</h2>
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
        const FirstName = user.FirstName || user.FullName?.split(" ")[0] || "Customer";
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
        });
    } catch (emailError) {
        console.error('Failure email sending failed:', emailError);
    }
};

module.exports = {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge,
    withRetry,
    // verifyWebhookSignature
};