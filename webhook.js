// const verifyWebhookSignature = require('../../utils/korapayWebhook.util');
const walletModel = require('../../model/walletModel');


// utils/korapayWebhook.util.js
const crypto = require('crypto');

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
        const data = req.body.data;

        // Handle different webhook events
        switch (event) {
            case 'charge.success':
                await handleSuccessfulCharge(data);
                break;
                
            case 'charge.failure':
                await handleFailedCharge(data);
                break;
                
            case 'transfer.success':
                // Handle transfer success if needed
                break;
                
            default:
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