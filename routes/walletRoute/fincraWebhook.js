const express = require("express");
const crypto = require("crypto");
const usdAccountModel = require ("../../model/usdAccount.Model");
const router = express.Router();


// Webhook handler for Fincra notifications
router.post("/",  async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('Fincra USD Webhook received:', JSON.stringify(webhookData, null, 2));

        // Verify webhook signature if needed
        // const signature = req.headers['x-fincra-signature'];
        // if (!verifyFincraSignature(webhookData, signature)) {
        //     return res.status(400).json({ error: 'Invalid signature' });
        // }

        const fincraSecret = process.env.fincra_api_key;
        // const fincraSignature = req.headers['x-fincra-signature'];

        if (fincraSignature !== fincraSecret) {
            return res.status(401).json({ message: 'Unauthorized: Invalid signature' });
        }

        const payload = req.body;
        const encryptedData =  crypto
            .createHmac("SHA512", fincraSecret)
            .update(JSON.stringify(payload))
            .digest("hex");
        const signatureFromWebhook = req.headers['signature'];

        if(encryptedData === signatureFromWebhook) {
        console.log("process");
        }
        else {
        console.log("discard");
        }

        const { event, data } = webhookData;

        // Find the corresponding virtual account
        const usdVirtualAccount = await usdAccountModel.findOne({ 
            fincraAccountId: data.id 
        });

        if (!usdVirtualAccount) {
            console.error('USD Virtual account not found for webhook:', data.id);
            return res.status(404).json({ error: 'Virtual account not found' });
        }

        switch (event) {
            case 'virtualaccount.approved':
                await usdAccountModel.findOneAndUpdate(
                    { fincraAccountId: data.id },
                    {
                        $set: {
                            status: 'approved',
                            updatedAt: new Date()
                        }
                    }
                );
                console.log('USD Virtual account approved:', data.id);
                break;

            case 'virtualaccount.issued':
                await usdAccountModel.findOneAndUpdate(
                    { fincraAccountId: data.id },
                    {
                        $set: {
                            status: 'issued',
                            isActive: true,
                            accountNumber: data.accountInformation.accountNumber,
                            bankName: data.accountInformation.bankName,
                            bankCode: data.accountInformation.bankCode,
                            accountReference: data.accountInformation.reference,
                            updatedAt: new Date()
                        }
                    }
                );
                console.log('USD Virtual account issued:', data.id);
                break;

            case 'virtualaccount.declined':
                await usdAccountModel.findOneAndUpdate(
                    { fincraAccountId: data.id },
                    {
                        $set: {
                            status: 'declined',
                            declineReason: data.reason,
                            updatedAt: new Date()
                        }
                    }
                );
                console.log('USD Virtual account declined:', data.id, 'Reason:', data.reason);
                break;

            case 'virtualaccount.closed':
                await usdAccountModel.findOneAndUpdate(
                    { fincraAccountId: data.id },
                    {
                        $set: {
                            status: 'closed',
                            isActive: false,
                            closureReason: data.reason,
                            updatedAt: new Date()
                        }
                    }
                );
                console.log('USD Virtual account closed:', data.id, 'Reason:', data.reason);
                break;

            default:
                console.log('Unknown webhook event:', event);
        }

        // res.status(200).json({ received: true });
        // Send success response
        res.status(200).json({ 
            received: true,
            message: `Webhook processed successfully for event: ${event}`
        });


    } catch (error) {
        console.error('Error handling Fincra USD webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;