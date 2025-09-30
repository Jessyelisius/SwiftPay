const { default: mongoose } = require("mongoose");
const kycModel = require("../../model/kyc.Model");
const { decryptKYCData } = require("../../utils/random.util");
const usdAccountModel = require("../../model/usdAccount.Model");
const axios = require("axios");
const walletModel = require("../../model/walletModel");
const { validateFincraDocuments, processDocumentsForFincra } = require("../../utils/uploadDocument.utils");


const CreateUsdVirtualAccount = async(req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user  = req.user; // Assuming user is attached to req object via middleware
        // const {utilityBill, bankStatement, meansOfId} = req.body;

        // Validation checks
        if (!user?.isKycVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "KYC not verified" });
        }
        if (!user?.isprofileVerified) {
            await session.abortTransaction();
            return res.status(403).json({ Error: true, Message: "Profile not verified" });
        }

        // Validate required documents
        // if (!utilityBill || !bankStatement || !meansOfId) {
        //     await session.abortTransaction();
        //     return res.status(400).json({ 
        //         Error: true, 
        //         Message: "All documents required: utilityBill, bankStatement, and meansOfId" 
        //     });
        // }
        // Validate uploaded documents
        const validationErrors = validateFincraDocuments(req.files);
        if (validationErrors.length > 0) {
            await session.abortTransaction();
            return res.status(400).json({
                Error: true,
                Message: 'Document validation failed',
                Errors: validationErrors
            });
        }

        // Get document URLs
        const { utilityBill, bankStatement, meansOfId } = processDocumentsForFincra(req.files);

         const kycData = await kycModel.findOne({ userid: user._id }).session(session);
        
        if (!kycData) {
            await session.abortTransaction();
            return res.status(400).json({ Error: true, Message: "KYC data not found" });
        }

         // Check if user already has a USD virtual account
        let existingUsdAccount = await usdAccountModel.findOne({ userId: user._id }).session(session);
        
        if (existingUsdAccount) {
            await session.commitTransaction();
            return res.status(200).json({
                Error: false,
                Message: "USD virtual account already exists",
                Data: {
                    accountNumber: existingUsdAccount.accountNumber,
                    accountName: existingUsdAccount.accountName,
                    bankName: existingUsdAccount.bankName,
                    status: existingUsdAccount.status,
                    fincraAccountId: existingUsdAccount.fincraAccountId
                }
            });
        }

        // Decrypt KYC data
        let decryptedKycData;
        try {
            const plainKycData = kycData.toObject();
            decryptedKycData = decryptKYCData(plainKycData, process.env.encryption_key);
            console.log('Decrypted KYC Data for USD account:', decryptedKycData);
        } catch (decryptError) {
            console.error('Decryption error:', decryptError);
            await session.abortTransaction();
            return res.status(400).json({ 
                Error: true, 
                Message: "Failed to decrypt KYC data. Please re-verify your KYC." 
            });
        }

         // Prepare Fincra USD Virtual Account request data
        const fincraData = {
            currency: "USD",
            accountType: "individual",
            utilityBill: utilityBill,
            bankStatement: bankStatement,
            meansOfId: Array.isArray(meansOfId) ? meansOfId : [meansOfId],
            KYCInformation: {
                address: {
                    state: user.State || "Lagos",
                    city: user.City || "Lagos",
                    street: user.Address || "Street Address",
                    zip: user.PostalCode || "100001",
                    countryOfResidence: user.Country || "NG",
                    number: user.HouseNumber || "1"
                },
                email: user.Email,
                incomeBand: "$0 - $2,000", // You can make this dynamic based on user data
                sourceOfIncome: user.SourceOfIncome || "Business",
                accountDesignation: "Personal use",
                phone: user.PhoneNumber,
                occupation: user.Occupation || "Business",
                nationality: user.Country || "NG",
                birthDate: user.DateOfBirth || "1990-01-01", // Format: YYYY-MM-DD
                taxCountry: "US", // For USD accounts
                firstName: user.FirstName,
                lastName: user.LastName,
                document: {
                    type: kycData.idType === 'passport' ? 'passport' : 'nationalId',
                    number: decryptedKycData.idNumber,
                    issuedCountryCode: user.Country || "NG",
                    issuedBy: "government",
                    issuedDate: kycData.issuedDate || "2020-01-01",
                    expirationDate: kycData.expirationDate || "2030-01-01"
                },
                employmentStatus: user.EmploymentStatus || "Business"
            }
        };


        // Add tax number if tax country is US
        if (fincraData.KYCInformation.taxCountry === "US" && user.TaxNumber) {
            fincraData.KYCInformation.taxNumber = user.TaxNumber;
        }

        console.log('Fincra USD Request Data:', JSON.stringify(fincraData, null, 2));

        // Make request to Fincra API
        // const fincraResponse = await axios.post('https://api.fincra.com/profile/virtual-accounts/requests', fincraData, {
        const fincraResponse = await axios.post('https://sandboxapi.fincra.com/profile/virtual-accounts/requests', fincraData, {
            // headers: {
            //     'api-key': process.env.fincra_api_key,
            //     'Accept': 'application/json',
            //     'Content-Type': 'application/json'
            // }
             headers: {
                Authorization: process.env.fincra_api_key,
                Accept: "application/json",
                "Content-Type": "application/json"
            }
        });

        const fincraResult = fincraResponse.data;
        
        console.log('Fincra Response:', JSON.stringify(fincraResult, null, 2));

        if (!fincraResult.success) {
            console.error('Fincra API Error:', fincraResult);
            await session.abortTransaction();
            return res.status(400).json({ 
                Error: true, 
                Message: fincraResult.message || 'Failed to create USD virtual account',
                Details: fincraResult.errors || fincraResult
            });
        }

        // Save USD virtual account details to database
        const usdVirtualAccount = new usdAccountModel({
            userId: user._id,
            fincraAccountId: fincraResult.data._id,
            currency: 'USD',
            accountType: 'individual',
            status: fincraResult.data.status, // 'pending', 'approved', 'declined'
            accountNumber: null, // Will be updated via webhook when approved
            accountName: null,
            bankName: null,
            bankCode: null,
            accountReference: null,
            isActive: false, // Will be activated when account is issued
            requestData: fincraData,
            responseData: fincraResult.data,
            createdAt: new Date()
        });

        await usdVirtualAccount.save({ session });
        
        // Update wallet model
        await walletModel.findOneAndUpdate(
            { userId: user._id },
            {
                $set: {
                    hasUsdVirtualAccount: true,
                    usdVirtualAccount: usdVirtualAccount._id
                }
            },
            { session }
        );

        await session.commitTransaction();

        return res.status(201).json({
            Error: false,
            Message: fincraResult.message || "USD virtual account request submitted successfully. You will be notified once approved.",
            Data: {
                fincraAccountId: usdVirtualAccount.fincraAccountId,
                status: usdVirtualAccount.status,
                currency: 'USD',
                accountType: 'individual',
                message: "Your USD virtual account is being processed. This may take a few minutes to complete."
            }
        });


    } catch (error) {
        await session.abortTransaction();
        console.error('Error creating USD virtual account:', error);
        
        return res.status(500).json({
            Error: true,
            Message: error.response?.data?.message || error.message || "Failed to create USD virtual account",
            Details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }finally {
        await session.endSession();
    }

};

const getUsdVirtualAccountDetails = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ Error: true, Message: "Unauthorized" });
        }

        // Validation checks
        if (!user?.isKycVerified) {
            return res.status(403).json({ Error: true, Message: "KYC not verified" });
        }
        if (!user?.isprofileVerified) {
            return res.status(403).json({ Error: true, Message: "Profile not verified" });
        }

        // Check if user has a USD virtual account
        const usdVirtualAccount = await usdAccountModel.findOne({ userId: user._id });
        if (!usdVirtualAccount) {
            return res.status(404).json({ Error: true, Message: "USD virtual account not found" });
        }

        // Fetch virtual account details from Fincra
        // const fincraResponse = await axios.get(`https://api.fincra.com/profile/virtual-accounts/${usdVirtualAccount.fincraAccountId}`, {
        const fincraResponse = await axios.get(`https://sandboxapi.fincra.com/profile/virtual-accounts/${usdVirtualAccount.fincraAccountId}`, {
            // headers: {
            //     'api-key': process.env.fincra_api_key,
            //     'Accept': 'application/json'
            // }
            headers: {
                Authorization: process.env.fincra_api_key,
                Accept: "application/json"
            }
        });

        const fincraResult = fincraResponse.data;
        
        console.log('Fincra USD Account Details:', JSON.stringify(fincraResult, null, 2));

        if (!fincraResult.success) {
            console.error('Fincra API Error:', fincraResult);
            return res.status(400).json({ 
                Error: true, 
                Message: fincraResult.message || 'Failed to fetch USD virtual account details',
                Details: fincraResult.errors || fincraResult
            });
        }

        // Update local database with latest info if account is approved and issued
        if (fincraResult.data.status === 'approved' && fincraResult.data.accountInformation) {
            await usdAccountModel.findOneAndUpdate(
                { userId: user._id },
                {
                    $set: {
                        status: fincraResult.data.status,
                        accountNumber: fincraResult.data.accountInformation.accountNumber,
                        accountName: `${user.FirstName} ${user.LastName}`,
                        bankName: fincraResult.data.accountInformation.bankName,
                        bankCode: fincraResult.data.accountInformation.bankCode,
                        accountReference: fincraResult.data.accountInformation.reference,
                        isActive: true,
                        updatedAt: new Date()
                    }
                }
            );
        }

        return res.status(200).json({
            Error: false,
            Message: "USD virtual account details fetched successfully",
            Data: {
                // Local virtual account details
                fincraAccountId: usdVirtualAccount.fincraAccountId,
                currency: 'USD',
                accountType: 'individual',
                status: fincraResult.data.status,
                isActive: fincraResult.data.status === 'approved',
                
                // Account information (available only when approved and issued)
                accountNumber: fincraResult.data.accountInformation?.accountNumber || null,
                accountName: fincraResult.data.accountInformation ? `${user.FirstName} ${user.LastName}` : null,
                bankName: fincraResult.data.accountInformation?.bankName || null,
                bankCode: fincraResult.data.accountInformation?.bankCode || null,
                accountReference: fincraResult.data.accountInformation?.reference || null,
                
                // Live Fincra data
                FincraData: fincraResult.data,
                
                // Monthly limit info
                monthlyLimit: "$10,000 USD",
                supportedTransactions: "ACH transactions only"
            }
        });

    } catch (error) {
        console.error('Error fetching USD virtual account details:', error);
        return res.status(500).json({
            Error: true,
            Message: error.response?.data?.message || error.message || "Failed to fetch USD virtual account details",
            Details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};


module.exports = {
    CreateUsdVirtualAccount,
    getUsdVirtualAccountDetails,
};