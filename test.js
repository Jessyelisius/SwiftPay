const crypto = require('crypto');
const {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge,
} = require("./webhook");

// Set test secret (should match your .env in real usage)
process.env.KORAPAY_WEBHOOK_SECRET = 'your_test_webhook_secret';

const testSecret = process.env.KORAPAY_WEBHOOK_SECRET;

const fakeData = {
    event: "charge.success",
    data: {
        amount: 600000,
        currency: "NGN",
        reference: "KPY-CA-wnzzA3KMeBhkUIE",
        status: "success",
    },
};

// Generate a valid signature for testing
const generateTestSignature = (payload) => {
    return crypto
        .createHmac('sha512', testSecret)
        .update(JSON.stringify(payload))
        .digest('hex');
};

const testWebhook = async () => {
    try {
        const testSignature = generateTestSignature(fakeData);
        
        const req = {
            headers: {
                'x-korapay-signature': `sha512=${testSignature}`,
            },
            body: fakeData,
        };

        const res = {
            status: (code) => ({
                json: (data) => {
                    console.log(`Response ${code}:`, data);
                    if (code === 200) {
                        console.log('✅ Webhook test passed!');
                    } else {
                        console.log('❌ Webhook test failed');
                    }
                },
            }),
        };

        console.log('Starting webhook test...');
        await handleKorapayWebhook(req, res);
        
    } catch (error) {
        console.error('Test failed:', error);
    }
};

testWebhook();