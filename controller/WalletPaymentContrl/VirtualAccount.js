const { default: mongoose } = require("mongoose");
const kycModel = require("../../model/kyc.Model");
const VirtualAccount = require("../../model/virtualAccount.Model");
const walletModel = require("../../model/walletModel");
const { decryptKYCData } = require("../../utils/random.util");

const DepositWithVisualAccount = async (req, res) => {
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

        // Decrypt the ID number (BVN)
        const decryptedIdNumber = decryptKYCData(kycData.idNumber, process.env.encryption_key);
        if (!decryptedIdNumber) {
            await session.abortTransaction();
            return res.status(400).json({ Error: true, Message: "Invalid KYC data" });
        }

        // Validate BVN format
        if (!/^\d{11}$/.test(decryptedIdNumber)) {
            await session.abortTransaction();
            return res.status(400).json({ Error: true, Message: "Invalid BVN format. BVN must be 11 digits" });
        }

        // Only proceed if the KYC type is BVN
        if (kycData.idType !== 'bvn') {
            await session.abortTransaction();
            return res.status(400).json({ Error: true, Message: "Virtual account creation requires BVN verification" });
        }

        // Prepare Korapay request data according to API documentation
        const korapayData = {
            account_name: `${user.FirstName} ${user.LastName}`,
            account_reference: `VBA_${user._id}_${Date.now()}`,
            permanent: true,
            bank_code: "035", // Wema Bank
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
            korapayAccountId: korapayResult.data.unique_id, // Note: using unique_id instead of id
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

module.exports = {
    DepositWithVisualAccount
};