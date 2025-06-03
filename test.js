const crypto = require('crypto');
const {
    handleKorapayWebhook,
    handleSuccessfulCharge,
    handleFailedCharge,
} = require("./webhook");

// 1. SET TEST SECRET - Use the same secret as in your .env file
const TEST_SECRET = 'https://swiftpay-8evb.onrender.com/korapay-webhook'; // REPLACE WITH YOUR ACTUAL SECRET
process.env.korapay_webhook = TEST_SECRET;

// 2. TEST DATA
const testPayload = {
    event: "charge.success",
    data: {
        amount: 600000,
        currency: "NGN",
        reference: "KPY-TEST-123456",
        status: "success",
        customer: {
            email: "test@example.com",
            name: "Test User"
        }
    }
};

// 3. SIGNATURE GENERATOR
const generateTestSignature = (payload, secret) => {
    if (!secret) {
        throw new Error('Webhook secret is required for signature generation');
    }
    return crypto
        .createHmac('sha512', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
};

// 4. TEST FUNCTION
const runWebhookTest = async () => {
    try {
        console.log('Starting webhook test...');
        
        // Generate valid signature
        const validSignature = generateTestSignature(testPayload, TEST_SECRET);
        
        // Create mock request
        const mockRequest = {
            headers: {
                'x-korapay-signature': `sha512=${validSignature}`,
            },
            body: testPayload
        };

        // Mock response object
        const mockResponse = {
            status: (statusCode) => {
                console.log(`Response Status: ${statusCode}`);
                return {
                    json: (data) => {
                        console.log('Response Data:', data);
                        if (statusCode === 200) {
                            console.log('✅ Webhook test passed successfully!');
                        } else {
                            console.log('❌ Webhook test failed');
                        }
                    }
                };
            }
        };

        // Execute the webhook handler
        await handleKorapayWebhook(mockRequest, mockResponse);

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
};

// 5. RUN THE TEST
runWebhookTest();