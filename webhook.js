const walletModel = require('./model/walletModel');
const transactions = require('./model/transactionModel');
const AdminTransaction = require('./model/admin/transactionModelAdmin');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Sendmail } = require('./utils/mailer.util');
const transactionModelAdmin = require('./model/admin/transactionModelAdmin');
const VirtualAccount = require('./model/virtualAccount.Model');
const userModel = require('./model/userModel');
const { log } = require('console');
// const transactionModel = require('./model/transactionModel');

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
                { status: webhookData.event === 'charge.success' ? 'success' : 
                          webhookData.event === 'transfer.success' ? 'success' : 'failed' }
            ]
        });
        
        if (existingAdminTx) {
            console.log(`✅ Webhook event already processed: ${webhookData.event} for ${transactionReference}`);
            return res.status(200).json({ received: true, message: 'Already processed' });
        }
        
        // Process webhook with retry logic
        // await withRetry(async () => {
            // if (webhookData.event === "charge.success") {
            //     await handleSuccessfulCharge(webhookData.data, webhookData.event);
            if (webhookData.event === "charge.success") {
                const isVirtualAccount = webhookData.data?.virtual_bank_account_details?.virtual_bank_account?.bank_name;

                if (isVirtualAccount) {
                    await VirtualAccountTransferSuccess(webhookData.data, webhookData.event);
                } else {
                    await handleSuccessfulCharge(webhookData.data, webhookData.event);
                }
            } else if (webhookData.event === "charge.failed") {
                await handleFailedCharge(webhookData.data, webhookData.event);
            } else if (webhookData.event === "transfer.success") {
                await handleTransferSuccess(webhookData.data, webhookData.event);
            } else if (webhookData.event === "transfer.failed") {
                await handleTransferFailed(webhookData.data, webhookData.event);
            } else {
                console.log(`Unhandled event type: ${webhookData.event}`);
            }
        // });
    
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
    let userInfo = null;
    let transactionData = null;

    try {
        await session.withTransaction(async() => {
            const { reference, amount, currency } = data;
            webhookReference = reference;

            console.log(`Processing transfer success: ${webhookReference}`);
            
            // First check if transaction is already successful
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

            // If transaction is already successful, skip processing
            if(transaction.status === 'success') {
                console.log(`SKIPPING: Transaction ${webhookReference} is already successful`);
                return;
            }

            console.log(`Webhook event: ${webhookEvent}, Transaction status: ${transaction.status}`);

            //check if this webhook event was already processed
            const existingAdminTx = await AdminTransaction.findOne({
                $or: [
                    { reference: webhookReference },
                    { korapayReference: webhookReference }
                ],
                // 'metadata.webhookEvent': webhookEvent,
                status: 'success'
            }).session(session);

            if(existingAdminTx) {
                console.log(`SKIPPING: Admin transaction already exists for webhook event: ${webhookEvent} with reference: ${webhookReference}`);
                return; // exit don't do anything else
            }

            // Store user info and transaction data for email sending
            userInfo = {
                FirstName: transaction.userId.FirstName || "Customer",
                Email: transaction.userId.Email,
                userId: transaction.userId._id
            };
            transactionData = {
                amount: transaction.amount,
                reference: transaction.reference,
                fee: transaction.metadata?.fee || 0,
                totalDeduction: transaction.metadata?.totalDeduction || (transaction.amount + (transaction.metadata?.fee || 0)),
                recipient: transaction.metadata?.recipient || {},
                narration: transaction.metadata?.narration || 'SwiftPay Bank Transfer'
            };

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

            //create admin transaction with improved metadata
            const adminTxResult = await AdminTransaction.findOneAndUpdate({
                $or: [
                    { reference: webhookReference },
                    { korapayReference: webhookReference }
                ],
                // 'metadata.webhookEvent': webhookEvent
            },{status: 'success'}).session(session);

            return;

            },
        {
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
          maxTimeMS: 30000 // Add timeout
        });

        // Send success email outside of transaction
        if (userInfo && transactionData) {
            // Get updated wallet balance
            const userWallet = await walletModel.findOne({ userId: userInfo.userId });
            
            await withRetry(async () => {
                await Sendmail(userInfo.Email, "SwiftPay Transfer Successful",
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="brand">SwiftPay</div>
    </div>

    <div class="content">
      <div class="greeting">
        Hello <strong>${userInfo.FirstName}</strong>,
      </div>

      <div class="success-badge">
        <div class="success-text">Transfer Completed Successfully</div>
        <div class="success-amount">₦${transactionData.amount.toLocaleString()}</div>
      </div>

      <div class="receipt-card">
        <div class="section-header">Transaction Details</div>
        <div class="section-content">
          <div class="detail-row">
            <div class="label">Amount Sent</div>
            <div class="value amount-value">₦${transactionData.amount.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction Fee</div>
            <div class="value">${transactionData.fee > 0 ? `₦${transactionData.fee.toLocaleString()}` : 'FREE'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Total Debited</div>
            <div class="value amount-value">₦${transactionData.totalDeduction.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Current Balance</div>
            <div class="value balance-value">₦${(userWallet?.balance || 0).toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction ID</div>
            <div class="value reference-value">${transactionData.reference}</div>
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
            <div class="value">${transactionData.recipient.accountName || 'N/A'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Account Number</div>
            <div class="value">${transactionData.recipient.accountNumber || 'N/A'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Bank</div>
            <div class="value">${transactionData.recipient.bankName || 'N/A'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Narration</div>
            <div class="value">${transactionData.narration}</div>
          </div>
        </div>
      </div>

      <div class="thank-you">
        Thank you for using SwiftPay. Keep this receipt for your records.
        ${transactionData.fee === 0 ? '<br><strong>🎉 This was a FREE transfer!</strong>' : ''}
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
    </div>
  </div>
</body>
</html>
                `
                );
            });
            console.log(`Success email sent to: ${userInfo.Email}`);
        }
    } catch (error) {
        console.error(`Error processing transfer success: ${webhookReference}`, error);
        throw error;
    } finally {
        await session.endSession();
    }
};

const handleTransferFailed = async(data, webhookEvent = null) => {
    const session = await mongoose.startSession();
    let failedReference;
    let userInfo = null;
    let transactionData = null;

    try {
        await session.withTransaction(async() => {
            const { reference, reason, amount } = data;
            failedReference = reference;
            console.log(`Processing failed transfer: ${reference}, Reason: ${reason}`);

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

            // Calculate totalDeduction from transaction metadata
            const totalDeduction = transaction.metadata?.totalDeduction || 
                (amount + (transaction.metadata?.fee || 0));

            // Store user info and transaction data for email sending
            userInfo = {
                FirstName: transaction.userId.FirstName || "Customer",
                Email: transaction.userId.Email,
                userId: transaction.userId._id
            };
            transactionData = {
                amount: transaction.amount,
                reference: transaction.reference,
                fee: transaction.metadata?.fee || 0,
                totalDeduction: totalDeduction,
                recipient: transaction.metadata?.recipient || {},
                narration: transaction.metadata?.narration || 'SwiftPay Bank Transfer',
                failureReason: reason
            };

            // Check if this webhook event was already processed
            const existingAdminTx = await AdminTransaction.findOne({
                $or: [
                    { reference: reference },
                    { korapayReference: reference }
                ],
                // 'metadata.webhookEvent': webhookEvent,
                status: 'failed'
            }).session(session);

            if (existingAdminTx) {
                console.log(`SKIPPING: Failed transfer webhook already processed for: ${reference}`);
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
            await walletModel.updateOne(
                {userId: transaction.userId._id},
                {
                    $inc: { balance: totalDeduction }, // Refund the wallet balance (reverse the deduction)
                    $push: {
                        transactions: {
                            reference: `refund-${transaction.reference}`,
                            type: 'refund',
                            amount: amount,
                            status: 'success',
                            currency: 'NGN',
                            method: 'bank_transfer',
                            narration: `Refund for failed transfer - ${reference}`,
                            createdAt: new Date(),
                            updatedAt: new Date(),
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

            //use upsert to handle duplicates gracefully and avoid duplicate entries
            const adminTxResult = await AdminTransaction.findOneAndUpdate(
                {
                    $or: [
                        { reference: reference },
                        { korapayReference: reference }
                    ],
                    // 'metadata.webhookEvent': webhookEvent
                },{status:"failed"}).session(session);

                console.log(`✅ Successfully processed failed transfer: ${reference}`);
                return;
        }, {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
            maxTimeMS: 30000 // Add timeout
        });

        // Send failure email outside transaction
        if (userInfo && transactionData) {
            // Get updated wallet balance
            const userWallet = await walletModel.findOne({ userId: userInfo.userId });
            
            await withRetry(async () => {
                await Sendmail(userInfo.Email, "SwiftPay Transfer Failed",
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="content">
      <div class="brand">SwiftPay</div>
      <div class="title">Bank Transfer Failed</div>

      <div class="greeting">
        Hello <strong>${userInfo.FirstName}</strong>,
      </div>

      <div class="failed-badge">
        <div class="failed-text">Transfer Failed</div>
        <div class="failed-amount">₦${transactionData.amount.toLocaleString()}</div>
      </div>

      <div class="reason-card">
        <div class="reason-title">Reason for Failure</div>
        <div class="reason-text">${transactionData.failureReason || 'The transfer could not be completed due to a technical issue. Please try again or contact support if the problem persists.'}</div>
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
            <div class="value amount-value">₦${transactionData.amount.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction Fee</div>
            <div class="value">${transactionData.fee > 0 ? `₦${transactionData.fee.toLocaleString()}` : 'FREE'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Amount Refunded</div>
            <div class="value amount-value">₦${transactionData.totalDeduction.toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Current Balance</div>
            <div class="value balance-value">₦${(userWallet?.balance || 0).toLocaleString()}</div>
          </div>
          <div class="detail-row">
            <div class="label">Transaction ID</div>
            <div class="value reference-value">${transactionData.reference}</div>
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
            <div class="value">${transactionData.recipient.accountName || 'N/A'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Account Number</div>
            <div class="value">${transactionData.recipient.accountNumber || 'N/A'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Bank</div>
            <div class="value">${transactionData.recipient.bankName || 'N/A'}</div>
          </div>
          <div class="detail-row">
            <div class="label">Narration</div>
            <div class="value">${transactionData.narration}</div>
          </div>
        </div>
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
                );
            });
            console.log(`Failure email sent to: ${userInfo.Email}`);
        }
    } catch (error) {
        console.error(`Error processing failed transfer: ${failedReference}`, error);
        throw error;
    } finally {
        await session.endSession();
    }
};

//virtual account deposit success handler
const VirtualAccountTransferSuccess = async(data, event) => {
  const session = await mongoose.startSession();

  session.startTransaction();
  try {
   
        //check if already processed
        const existingTransaction = await transactions.findOne({
          reference: data.reference
        }).session(session);

        if (existingTransaction) {
            console.log(`Transaction already exists: ${data.reference} and its processed`);
            await session.abortTransaction();
            return;
        }

         // Check if this is a virtual account deposit
        if (!data.virtual_bank_account_details) {
            console.log('Not a virtual account transaction');
            await session.abortTransaction();
            return;
        }

        //find the virtual account details using the payment_reference
        const accountReference = data.virtual_bank_account_details?.virtual_bank_account?.account_reference;

        //find the virtual account the user
        const virtualAccount = await VirtualAccount.findOne({
          accountReference: accountReference
        }).session(session);

        if(!virtualAccount) {
            console.log(`Virtual account not found for reference: ${accountReference}`);
            await session.abortTransaction();
            return;
        }

        const user = await userModel.findById(virtualAccount.userId).session(session);
        if (!user) {
            console.log(`User not found for virtual account: ${virtualAccount.userId}`);
            await session.abortTransaction();
            return;
        }

        // Calculate net amount ( tho Korapay deducts fees automatically)
        const depositAmount = data.amount - (data.fee || 0);

        //update user's wallet balance
        const wallet = await walletModel.findOneAndUpdate(
          {userId: user._id},
          {
            $inc:{balance: depositAmount},
            $set:{updatedAt: new Date()}
          },
          {session, new: true}
        );

        //create the transaction recordconst
        const transaction = new transactions({
          userId: user._id,
          type: 'deposit',
          method: 'virtual_account',
          amount: depositAmount,
          fee: data.fee || 0,
          currency: data.currency || 'NGN',
          status: 'success',
          reference: data.reference,
          korapayReference: data.payment_reference,
          narration: `Virtual Account Deposit - ${data.virtual_bank_account_details?.payer_bank_account?.bank_name}` || 'Virtual Account Deposit',
          metadata:{
            webhookEvent: event,
            payerDetails: data.virtual_bank_account_details?.payer_bank_account || {},
            virtualAccountDetails: data.virtual_bank_account_details?.virtual_bank_account || {},
            transactionDate: data.transaction_date || new Date(),
          },
          createdAt: new Date(),
        });

        await transaction.save({ session });

        //create admin transaction record
        const adminTransaction = new AdminTransaction({
            userId: user._id,
            transactionId: transaction._id,
            type: 'deposit',
            method: 'virtual_account',
            amount: depositAmount,
            fee: data.fee || 0,
            currency: data.currency || 'NGN',
            status: 'success',
            reference: data.reference,
            korapayReference: data.payment_reference,
            narration: transaction.narration || 'Virtual Account Deposit',
            metadata: transaction.metadata,
            createdAt: new Date(),
        });

        await adminTransaction.save({ session });
        // Commit the transaction
        await session.commitTransaction();
        console.log(`✅ Successfully processed virtual account deposit: ${depositAmount} for user ${user.Email}`);
        // session.endSession();
         await Sendmail(
        user.Email,
        "Credit Transaction - SwiftPay",
        `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <title>SwiftPay Credit Alert</title>
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
                    background-color: #000;
                    margin-top: 5px;
                    margin-bottom: 30px;
                }
                .alert-header {
                    text-align: center;
                    color: #22c55e;
                    font-size: 18px;
                    font-weight: bold;
                    margin-bottom: 20px;
                }
                .amount-display {
                    font-size: 32px;
                    font-weight: bold;
                    color: #000;
                    text-align: center;
                    margin: 20px 0;
                }
                .transaction-info {
                    border-top: 1px solid #e5e7eb;
                    border-bottom: 1px solid #e5e7eb;
                    padding: 20px 0;
                    margin: 20px 0;
                }
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 14px;
                }
                .info-label {
                    color: #6b7280;
                }
                .info-value {
                    color: #111827;
                    font-weight: 500;
                }
                .footer {
                    margin-top: 30px;
                    font-size: 0.85rem;
                    color: #777;
                    text-align: center;
                }
                .footer-divider {
                    width: 100%;
                    height: 2px;
                    background-color: #000;
                    margin: 30px 0 10px;
                }
            </style>
        </head>
        <body>
            <div class="email-wrapper">
                <div class="brand-logo">SwiftPay</div>
                <div class="divider"></div>
                
                <div class="alert-header">CREDIT ALERT</div>
                
                <p style="text-align: center; color: #111827; font-size: 16px; margin: 10px 0;">
                    // Dear <strong>${user.FirstName} ${user.LastName}</strong>
                </p>
                
                <div class="amount-display">${depositAmount.toLocaleString()}</div>
                
                <div class="transaction-info">
                    <div class="info-row">
                        <span class="info-label">Date:</span>
                        <span class="info-value">${new Date(data.transaction_date).toLocaleString('en-NG')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Reference:</span>
                        <span class="info-value">${data.reference}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">From:</span>
                        <span class="info-value">${data.virtual_bank_account_details?.payer_bank_account?.bank_name || 'Bank Transfer'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Sender Name:</span>
                        <span class="info-value">${data.virtual_bank_account_details?.payer_bank_account?.account_name || 'N/A'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Type:</span>
                        <span class="info-value">Bank Transfer</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Balance:</span>
                        <span class="info-value">${wallet.balance?.toLocaleString()}</span>
                    </div>
                </div>
                
                <p style="text-align: center; color: #6b7280; font-size: 14px; margin: 20px 0;">
                    Your SwiftPay wallet has been credited.
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


  } catch (error) {
    await session.abortTransaction();
    console.error(`Error processing virtual account deposit: ${data.reference}`, error);
    throw error;
  }
  finally {
    await session.endSession();
  }
}

module.exports = {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge,
    withRetry,
    handleTransferSuccess,
    handleTransferFailed,
    VirtualAccountTransferSuccess
    // verifyWebhookSignature
};