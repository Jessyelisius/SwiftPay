const { default: axios } = require("axios");
const kycModel = require("../../model/kyc.Model");
const userModel = require("../../model/userModel");
const { Sendmail } = require("../../utils/mailer.util");
const {ErrorDisplay, encryptKYCData, generateEncryptionKey, generateSalt, hashData} = require("../../utils/random.util");
const profileModel = require("../../model/profile.Model");

const submitKYC = async (req, res) => {
    try {
        const { idType, idNumber } = req.body;

        if (!idType || !idNumber) return res.status(400).json({ Error: true, Message: "All fields are required" });

        const existingKyc = await kycModel.findOne({ userId: req.user.id });
        if (existingKyc) return res.status(400).json({ Error: true, Message: "You've already submitted your KYC" });

        const user = await userModel.findById(req.user.id);
        if (!user) return res.status(404).json({ Error: true, Message: "User not found" });

        if (!user?.isprofileVerified) {
            return res.status(400).json({ Error: true, Message: "Please complete your profile before going for KYC" });
        }

        let integrate;

        if (idType === 'nin') {
            if (isNaN(idNumber)) return res.status(400).json({ Access: true, Error: 'NIN must be numeric' });
            if (idNumber.length !== 11) return res.status(400).json({ Access: true, Error: 'NIN must be 11 digits' });

            integrate = (await axios({
                url: 'https://integrations.getravenbank.com/v1/nin/verify',
                method: 'post',
                headers: {
                    "Authorization": `Bearer ${process.env.raven_api_key}`,
                    "Content-Type": 'application/json'
                },
                data: { nin: idNumber }
            })).data;
        } else if(idType === 'bvn'){
            if (isNaN(idNumber)) return res.status(400).json({ Access: true, Error: 'BVN must be numeric' });
            if (idNumber.length !== 11) return res.status(400).json({ Access: true, Error: 'BVN must be 11 digits' });

            integrate = (await axios({
                url: 'https://integrations.getravenbank.com/v1/bvn/verify',
                method: 'post',
                headers:{
                    "Authorization": `Bearer ${process.env.raven_api_key}`,
                    "Content-Type": 'application/json'
                },
                data: {bvn: idNumber }
            })).data;

        }else if(idType === 'bvn') {

            if (idNumber.length !== 19) return res.status(400).json({ Access: true, Error: 'Voter’s card must be 19 digits' });

            integrate = (await axios({
                url: 'https://integrations.getravenbank.com/v1/pvc/verify',
                method: 'post',
                headers: {
                    "Authorization": `Bearer ${process.env.raven_api_key}`,
                    "Content-Type": 'application/json'
                },
                data: { voters_card: idNumber }
            })).data;
        }else{
            return res.status(400).json({Error:true, Message:"invalid ID selection, pls select within the listed Options"})
        }

        if (!integrate || !integrate.data) return res.status(400).json({ Error: true, Message: `Couldn't verify ${idType}` });

        const NinFirstname = integrate.data.firstname;
        const NinLastname = integrate.data.lastname;
        const fullName = `${user.FirstName} ${user.LastName}`.toLowerCase();

        if (
            !fullName.includes(NinFirstname.toLowerCase()) &&
            !fullName.includes(NinLastname.toLowerCase())
        ) {
            return res.status(400).json({ Access: true, Error: 'Your name does not match the one on the ID,' });
        }

        const encryptionKey = process.env.encryption_key;
        if(!encryptionKey){
            console.error('KYC_ENCRYPTION_KEY not found in environment variables');
            return res.status(500).json({ Error: true, Message: "Server configuration error" });
        }
        
        //prepare data to encrypt
        const KycDataToEncrypt = {
            idNumber: idNumber,
            phone: integrate.data.phone || user.Phone
        }

        // Encrypt sensitive KYC data
        const encryptedKycData = encryptKYCData(KycDataToEncrypt, encryptionKey);

        //create salt for hashing
        const salt = generateSalt();

        // Hash the ID number for search/comparison purposes (one-way)
        const hashedIdNumber = hashData(idNumber, salt);

        // Create KYC record with encrypted data
        await kycModel.create({
            userid: req.user.id,
            idType,
            idNumber: encryptedKycData.idNumber, // Encrypted
            idNumberHash: hashedIdNumber, // Hashed for comparison
            salt: salt, // Store salt for future comparisons
            // phone: encryptedKycData.phone, // Encrypted phone
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // Prepare KYC details for user model (keep some fields unencrypted for app functionality)
        const kycDetailsForUser = {
            ...integrate.data,
            // Keep these unencrypted for app functionality
            firstname: integrate.data.firstname,
            lastname: integrate.data.lastname,
            middlename: integrate.data.middlename,
            residentialAddress: integrate.data.residentialAddress,
            photo: integrate.data.photo,
            // Store encrypted sensitive data
            phone: encryptedKycData.phone,
            // Store the original ID number encrypted (for virtual account creation)
            idNumber: encryptedKycData.idNumber
        };

        await userModel.updateOne({ _id: req.user.id }, {
            KycType: idType,
            KycDetails: kycDetailsForUser,
            isKycVerified: true, // Auto-verify after successful KYC
            updatedAt: new Date()
        });


        await profileModel.updateOne({ user: req.user.id }, { 
            profilePhoto: integrate.data.photo,
            updatedAt: new Date()
        });

        // Return success response (don't expose sensitive data)
        res.status(200).json({
            Error: false, 
            Message: 'KYC submitted successfully!', 
            Data: {
                firstname: integrate.data.firstname,
                lastname: integrate.data.lastname,
                middlename: integrate.data.middlename,
                photo: integrate.data.photo,
                idType: idType,
                verified: true
            }
        });

        // Send confirmation email
        await Sendmail(user.Email, "KYC Submitted Successfully", 
            `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8" />
            <title>KYC Submission Successful</title>
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
                background-color: #6a0dad;
                margin-top: 5px;
                margin-bottom: 30px;
                }
                .success-badge {
                background-color: #10b981;
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: bold;
                display: inline-block;
                margin-bottom: 20px;
                }
                h2 {
                color: #222;
                font-size: 20px;
                }
                .footer {
                margin-top: 40px;
                font-size: 0.85rem;
                color: #777;
                text-align: center;
                }
                .footer-divider {
                width: 100%;
                height: 2px;
                background-color: #6a0dad;
                margin: 40px 0 10px;
                }
            </style>
            </head>
            <body>
            <div class="email-wrapper">
                <div class="brand-logo">SwiftPay</div>
                <div class="divider"></div>
                
                <div class="success-badge">✓ KYC VERIFIED</div>

                <h2>Your KYC Has Been Successfully Verified!</h2>
                <p>Hi <strong>${user.FirstName}</strong>,</p>
                <p>Great news! Your KYC verification has been completed successfully. Your account is now fully verified and you can access all SwiftPay features.</p>
                
                <p><strong>What's next?</strong></p>
                <ul>
                    <li>Create virtual accounts for easy deposits</li>
                    <li>Send and receive money instantly</li>
                    <li>Access all premium features</li>
                </ul>

                <p style="font-family: 'Georgia', cursive; font-size: 1rem; color: #d4af37;">
                — The SwiftPay Team
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
        console.log(error?.response?.data || error);
        return res.status(500).json({ Error: true, Message: ErrorDisplay(error).msg });
    }
};

module.exports = submitKYC;
