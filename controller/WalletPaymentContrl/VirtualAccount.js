const { default: mongoose } = require("mongoose");
const kycModel = require("../../model/kyc.Model");
const VirtualAccount = require("../../model/virtualAccount.Model");
const walletModel = require("../../model/walletModel");
const { decryptKYCData } = require("../../utils/random.util"); // Changed back to decryptKYCData
const axios  = require("axios");

const CreateVirtualAccount = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const user = req.user;

        // Validation checks
        if (!user?.isKycVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "KYC not verified" });
        }
        if (!user?.isprofileVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "Profile not verified" });
        }

        // Fetch KYC data to get idNumber
        const kycData = await kycModel.findOne({ userid: user._id }).session(session);
        
        if (!kycData) {
            await session.abortTransaction();
            return res.status(400).json({ Error: true, Message: "KYC data not found" });
        }

        // Check if user already has a virtual account
        let existingVirtualAccount = await VirtualAccount.findOne({ userId: user._id }).session(session);
        
        if (existingVirtualAccount) {
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Message: "Virtual account already exists",
                Data: {
                    accountNumber: existingVirtualAccount.accountNumber,
                    accountName: existingVirtualAccount.accountName,
                    bankName: existingVirtualAccount.bankName,
                    bankCode: existingVirtualAccount.bankCode
                }
            });
        }

        // Decrypt the KYC data - FIXED: Convert Mongoose document to plain object first
        let decryptedKycData;
        try {
            // Convert Mongoose document to plain object
            const plainKycData = kycData.toObject();
            console.log('Plain KYC Data:', plainKycData);
            
            decryptedKycData = decryptKYCData(plainKycData, process.env.encryption_key);
            console.log(`Decrypted KYC Data:`, decryptedKycData);
        } catch (decryptError) {
            console.error('Decryption error:', decryptError);
            await session.abortTransaction();
            return res.status(400).json({ 
                Error: true, 
                Message: "Failed to decrypt KYC data. Please re-verify your KYC." 
            });
        }

        // Extract the decrypted ID number
        let decryptedIdNumber = decryptedKycData.idNumber; // Changed from const to let

        // Ensure decryptedIdNumber is a string
        if (typeof decryptedIdNumber !== 'string') {
            console.error('Decrypted data is not a string:', typeof decryptedIdNumber, decryptedIdNumber);
            await session.abortTransaction();
            return res.status(400).json({ 
                Error: true, 
                Message: "Invalid decrypted data format" 
            });
        }

        // Clean the decrypted string (remove any whitespace)
        decryptedIdNumber = decryptedIdNumber.trim();
        
        // Validate BVN format
        if (!/^\d{11}$/.test(decryptedIdNumber)) {
            console.error(`Invalid BVN format. Expected 11 digits, got: "${decryptedIdNumber}" (length: ${decryptedIdNumber.length})`);
            await session.abortTransaction();
            return res.status(400).json({ 
                Error: true, 
                Message: "Invalid BVN format. BVN must be 11 digits" 
            });
        }

        // Only proceed if the KYC type is BVN
        if (kycData.idType !== 'bvn') {
            await session.abortTransaction();
            return res.status(400).json({ Error: true, Message: "Virtual account creation requires BVN verification" });
        }
        
        console.log(`Final BVN for API: ${decryptedIdNumber}`);

        // Prepare Korapay request data according to API documentation
        const korapayData = {
            account_name: `${user.FirstName} ${user.LastName}`,
            account_reference: `VBA_${user._id}_${Date.now()}`,
            permanent: true,
            bank_code: "000", // Use '000' for virtual accounts as per Korapay documentation for testing
            customer: {
                name: `${user.FirstName} ${user.LastName}`,
                email: user.Email
            },
            kyc: {
                bvn: decryptedIdNumber
            }
        };

        console.log('Korapay Request Data:', JSON.stringify(korapayData, null, 2));

        // Make request to Korapay API
        const korapayResponse = await fetch('https://api.korapay.com/merchant/api/v1/virtual-bank-account', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.kora_api_secret}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(korapayData)
        });

        const korapayResult = await korapayResponse.json();
        
        console.log('Korapay Response:', JSON.stringify(korapayResult, null, 2));

        if (!korapayResponse.ok || !korapayResult.status) {
            console.error('Korapay API Error:', korapayResult);
            await session.abortTransaction();
            return res.status(400).json({ 
                Error: true, 
                Message: korapayResult.message || 'Failed to create virtual account',
                Details: korapayResult.errors || korapayResult
            });
        }

        // Save virtual account details to database
        const virtualAccount = new VirtualAccount({
            userId: user._id,
            accountNumber: korapayResult.data.account_number,
            accountName: korapayResult.data.account_name,
            bankName: korapayResult.data.bank_name,
            bankCode: korapayResult.data.bank_code,
            accountReference: korapayResult.data.account_reference,
            korapayAccountId: korapayResult.data.unique_id,
            isActive: true,
            createdAt: new Date()
        });

        await virtualAccount.save({ session });
        
        // Update wallet model
        await walletModel.findOneAndUpdate(
            { userId: user._id },
            {
                $set: {
                    hasVirtualAccount: true,
                    virtualAccount: virtualAccount._id
                }
            },
            { session }
        );

        await session.commitTransaction();

        return res.status(201).json({
            Error: false,
            Message: "Virtual account created successfully",
            Data: {
                accountNumber: virtualAccount.accountNumber,
                accountName: virtualAccount.accountName,
                bankName: virtualAccount.bankName,
                bankCode: virtualAccount.bankCode,
                accountReference: virtualAccount.accountReference
            }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error creating virtual account:', error);
        
        return res.status(500).json({
            Error: true,
            Message: error.message || "Failed to create virtual account",
            Details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        await session.endSession();
    }
};

const getVirtualAccountDetails = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ Error: true, Message: "Unauthorized" });
        }

        //validation checks
        if (!user?.isKycVerified) {
            return res.status(403).json({ Error: true, Message: "KYC not verified" });
        }
        if (!user?.isprofileVerified) {
            return res.status(403).json({ Error: true, Message: "Profile not verified" });
        }

        //check if user has a virtual account
        const virtualAccount = await VirtualAccount.findOne({ userId: user._id });
        if (!virtualAccount) {
            return res.status(404).json({ Error: true, Message: "Virtual account not found" });
        }

        //fetch virtual account details from korapay
        const korapayResponse = await axios.get(`https://api.korapay.com/merchant/api/v1/virtual-bank-account/${virtualAccount.accountReference}`, {
            headers: {
                'Authorization': `Bearer ${process.env.kora_api_secret}`,
                'Content-Type': 'application/json',
            }
        });

        const korapayResult = await korapayResponse.data;
        
        // Log the response for debugging
        console.log('Korapay Virtual Account Details:', JSON.stringify(korapayResult, null, 2));


        if (!korapayResponse.ok || !korapayResult.status) {
            console.log('Korapay API Error:', korapayResult);
            return res.status(400).json({ 
                Error: true, 
                Message: korapayResult.message || 'Failed to fetch virtual account details',
                Details: korapayResult.errors || korapayResult
            });
        }

        return res.status(200).json({
            Error: false,
            Message: "Virtual account details fetched successfully",
            Data: {

                //local virtual account details
                accountNumber: korapayResult.data.account_number,
                accountName: korapayResult.data.account_name,
                bankName: korapayResult.data.bank_name,
                bankCode: korapayResult.data.bank_code,
                accountReference: korapayResult.data.account_reference,

                //live korapay virtual account details
                KorapayData: korapayResult.data,

                accountNumber: korapayResult.data.account_number || virtualAccount.accountNumber,
                accountName: korapayResult.data.account_name || virtualAccount.accountName,
                bankName: korapayResult.data.bank_name || virtualAccount.bankName,
                bankCode: korapayResult.data.bank_code || virtualAccount.bankCode,
                balance: korapayResult.data.balance || 0,
                currency: korapayResult.data.currency || virtualAccount.currency,
                status: korapayResult.data.status || virtualAccount.status,
                accountReference: korapayResult.data.account_reference || virtualAccount.accountReference
            }
        });

    } catch (error) {
        console.error('Error fetching virtual account details:', error);
        return res.status(500).json({
            Error: true,
            Message: error.message || "Failed to fetch virtual account details",
            Details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}



module.exports = {
    CreateVirtualAccount,
    getVirtualAccountDetails
};