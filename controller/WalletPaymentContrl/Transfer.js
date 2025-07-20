const { default: mongoose } = require("mongoose");
const transactionModel = require("../../model/transactionModel");

const { getWeeklyTransfers, generateId, calculateTransactionFee } = require("../../utils/random.util");
const walletModel = require("../../model/walletModel");
const { default: axios } = require("axios");
const adminModel = require("../../model/admin/admin.Model");
const transactionModelAdmin = require("../../model/admin/transactionModelAdmin");


const Transfer = async (req, res) => {

    const session = await mongoose.startSession();

    try {
        const user = req.user;

        if(!user) {
            return res.status(401).json({ message: "Unauthorized || user not found" });
        }

        if(!user?.isKYCVerified) {
            return res.status(403).json({ message: "Forbidden || KYC not verified" });
        }

        if(!user?.EmailVerif) {
            return res.status(403).json({ message: "Forbidden || Email not verified" });
        }

        if(!user?.isprofileVerified) {
            return res.status(403).json({ message: "Forbidden || Profile not verified" });
        }

        await session.withTransaction(async () => {

            const {amount, narration, recipient} = req.body;

            if(!amount || !recipient) {
                return res.status(400).json({ message: "Bad Request || Missing required fields" });
            }

            if(amount <= 0) {
                return res.status(400).json({ message: "Bad Request || Amount must be greater than 0" });
            }

            const existingTransaction = await transactionModel.findOne({ reference }).session(session);
            if(existingTransaction) {
                return res.status(400).json({ message: "Bad Request || Transaction with this reference already exists" });
            }

            const weeklyTransfers = await getWeeklyTransfers(user._id);

            //calculate fee using our simplified function
            const fee = calculateTransactionFee(amount, method, weeklyTransfers);
            const totalDeduction = amount + fee;
            const isFreeTransfer = fee === 3;

            // Console log fee details (instead of storing complex metadata)
            console.log('=== TRANSFER FEE CALCULATION ===');
            console.log(`User: ${user.FirstName} ${user.LastName} (${user._id})`);
            console.log(`Amount: ₦${amount.toLocaleString()}`);
            console.log(`Method: ${method}`);
            console.log(`Weekly transfers used: ${weeklyTransfers.length}/3`);
            console.log(`Fee calculated: ₦${fee.toLocaleString()}`);
            console.log(`Total deduction: ₦${totalDeduction.toLocaleString()}`);
            console.log(`Free transfer: ${isFreeTransfer ? 'YES' : 'NO'}`);
            console.log(`Platform revenue: ₦${fee.toLocaleString()}`); // This is your "money saved/earned"
            console.log('================================');

            const reference = generateId('SP', 'bank_transfer');

            const userWallet = await walletModel.findOne({ userId: user._id }).session(session);
            if(!userWallet) {
                return res.status(404).json({ message: "Not Found || User wallet not found" });
            }

            if(userWallet.balance < totalDeduction) {
                return res.status(400).json({ message: `Insufficient balance, Required: ₦${totalDeduction.toLocaleString()} ` +
                    `(Amount: ₦${amount.toLocaleString()} + Fee: ₦${fee.toLocaleString()}), ` +
                    `Available: ₦${userWallet.balance.toLocaleString()}` });
            }

            // Create the transaction
            const newTransaction = await transactionModel.create([{
                userId: user._id,
                amount: amount,
                currency: userWallet.currency,
                method: 'bank_transfer',
                type: 'transfer',
                status: 'pending',
                reference: reference,
                recipient: {
                    accountNumber: recipient.accountNumber,
                    accountName: recipient.accountName,
                    bankCode: recipient.bankCode,
                    bankName: recipient.bankName
                },
                metadata: {
                    narration: narration || '',
                    isFreeTransfer,
                    fee: fee,
                    totalDeduction: totalDeduction,
                    initiatedAt: new Date()
                }
            }], { session });

            //korapay payload
            const korapayPayload = {
                reference: reference,
                destination:{
                    type: 'bank_account',
                    amount: amount * 100, // Convert to kobo
                    currency: userWallet.currency,
                    narration: narration || `Transfer from ${user.FirstName} || SwiftPay user`,
                    bank_account: {
                        account_name: recipient.accountName,
                        account_number: recipient.accountNumber,
                        bank_name: recipient.bankName,
                        bank_code: recipient.bankCode
                    }

                },
                customer:{
                    name: `${user.FirstName} ${user.LastName}`,
                    email: user.Email,
                }

            };
        const korapayResponse = await axios.post(
                    'https://api.korapay.com/merchant/api/v1/charges/transfer', 
                    korapayPayload, 
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.kora_api_secret}`,
                            'Content-Type': 'application/json'
                        }
                    }
        );

        const transferData = korapayResponse.data;
        if(transferData.status !== true) {
            throw new Error(`Transfer failed: ${transferData.message}`);
        }

        // Update transaction with KoraPay reference
        
        await transactionModel.updateOne(
            {_id: newTransaction[0]._id},
            {
                korapayReference: transferData.data.reference,
                metadata: {
                        ...newTransaction[0].metadata,
                        korapayResponse: transferData.data,
                        korapayStatus: transferData.data.status
                    }
            },
            { session }
        );

        //deduct amount and fee from user's wallet
        await walletModel.updateOne(
            {userId: user._id},
            {
                $inc:{balance: -totalDeduction},
                $push:{
                    transactionModel:{
                        type: 'transfer',
                        amount: -totalDeduction,
                        method: 'bank_transfer',
                        status: 'pending',
                        reference: reference,
                        currency: userWallet.currency,
                        narration: narration || '',
                        fee: fee,
                        createdAt: new Date(),
                    }
                },
                lastTransaction: newTransaction[0]._id
            },
            { session }
        );

        // Admin transaction (minimal fee info for admin dashboard)
        await transactionModelAdmin.create([{
            userId: user._id,
            amount: amount,
            type: 'transfer',
            status: 'pending',
            reference: reference,
            currency: userWallet.currency,
            korapayReference: transferData.data.reference,
            metadata: {
                narration: narration || '',
                feeRevenue: fee,
                totalDeduction: totalDeduction,
                isFreeTransfer,
                paymentGateway: 'korapay',
                recipient: recipient,
                processedVia: 'api',
                initiatedAt: new Date()
            }

        }], { session });
         console.log(`✅ Transfer initiated successfully: ${reference}`);
    },
        {
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary'
        }
    );

      // Simple success response
      res.status(200).json({
        Access: true,
        Error: false,
        Message: 'Transfer is being processed. You will receive confirmation shortly.',
        Data: {
            reference: reference,
            amount: amount,
            fee: fee,
            totalDeduction: totalDeduction,
            recipient: recipient,
            narration: narration || '',
            isFreeTransfer,
            status: 'pending',
            feeCharged: calculateTransactionFee(req.body.method || 'bank_transfer', req.body.amount, await getWeeklyTransfers(user._id)),
            totalDeducted: req.body.amount + calculateTransactionFee(req.body.method || 'bank_transfer', req.body.amount, await getWeeklyTransfers(user._id))
            
            // reference: generateReference(), // You might want to use the same reference
                
        }
    });
    } catch (error) {
        console.error('Transfer error:', error);
        await session.abortTransaction();
        res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Transfer failed',
            Data: {
                error: error.message || 'An unexpected error occurred'
            }
        });
    } finally {
       await session.endSession();
    }
}

module.exports = Transfer;
