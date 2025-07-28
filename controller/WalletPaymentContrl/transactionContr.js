const { default: mongoose } = require("mongoose");
const transactionModel = require("../../model/transactionModel");
const walletModel = require("../../model/walletModel");
const { ErrorDisplay } = require("../../utils/random.util");


// Get user's transaction history with pagination and filtering
const getTransactionHistory = async(req, res)=>{
    try {
        const user = req.user;

        if(!user){
            return res.status(401).json({ Error: true, Message: "Unauthorized || user not found" });
        }

        // if(!user?.isKYCVerified) {
        //     return res.status(403).json({Error: true, Message: "Forbidden || KYC not verified" });
        // }

        if(!user?.EmailVerif) {
            return res.status(403).json({Error: true, Message: "Forbidden || Email not verified" });
        }

        if(!user?.isprofileVerified) {
            return res.status(403).json({Error: true, Message: "Forbidden || Profile not verified" });
        }

        const { 
            page = 1, 
            limit = 10, 
            type, // 'deposit', 'withdrawal', 'transfer'
            status, // 'pending', 'success', 'failed'
            currency, // 'NGN', 'USD'
            method, // 'card', 'virtual_account', 'bank_transfer', 'conversion'
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        //build filter object
        const filter = { userId: user._id };

        //add additional filters based on query parameters using tenary operators
        if (type) filter.type = type;
        if (status) filter.status = status;
        if (currency) filter.currency = currency;
        if (method) filter.method = method;

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        //calculate pagination
        const skip = (parseInt(page - 1)) * parseInt(limit);
        const limitNum = parseInt(limit);

        //build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        //execute query
        const [transactions, totalCount] = await Promise.all([
            transactionModel.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limitNum)
                .lean(),
                transactionModel.countDocuments(filter)
        ]);

        //calculate pagination details (not required but useful for frontend, cox na me de do fe)
        const totalPages = Math.ceil(totalCount / limitNum);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        //calculate user summary statistics for user
        const summaryStats = await transactionModel.aggregate([
            {$match: filter},
            {
                $group:{
                    _id: '$currency',
                    totalAmount: {$sum: '$amount'},
                    successfulTransactions: {
                        $sum: {$cond: [{$eq: ['$status', 'success']}, 1, 0]}
                    },
                    pendingTransactions: {
                        $sum: {$cond: [{$eq: ['$status', 'pending']}, 1, 0]}
                    },
                    failedTransactions: {
                        $sum: {$cond: [{$eq: ['$status', 'failed']}, 1, 0]}
                    },
                    totalFeesPaid: {$sum:{ $ifNull: ['$metadata.fee', 0]}} // Assuming feesPaid is stored in metadata
                }
            }
        ]);

        //format stats by currency
        const statsByCurrency = {};
        summaryStats.forEach(stat => {
            statsByCurrency[stat._id || 'NGN'] = {
                totalAmount: stat.totalAmount,
                successfulTransactions: stat.successfulTransactions,
                pendingTransactions: stat.pendingTransactions,
                failedTransactions: stat.failedTransactions,
                totalFeesPaid: stat.totalFeesPaid
            };
        });

        console.log('user transaction history found');
        console.log(`User: ${user.FirstName} ${user.LastName} (${user._id})`);
        console.log(`Total transactions found: ${totalCount}`);
        console.log(`Page ${page} of ${totalPages}`);
        console.log(`Currency filter: ${currency || 'ALL'}`);
        console.log(`Stats by currency:`, statsByCurrency);
        console.log('==========================================');

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: 'Transaction history retrieved successfully',
            Data: {
                transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalCount,
                    hasNextPage,
                    hasPrevPage,
                    limit: limitNum
                },
                summary: statsByCurrency
            }
        })

    } catch (error) {
        console.error('🧨 Error fetching user transaction history:', error);
        return res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Failed to retrieve transaction history',
            Data: {
                error: ErrorDisplay(error).message || 'An unexpected error occurred'
            }
        });
    }
}

//get user specific transaction detail
const getSingleTransaction = async(req, res) => {
    try {
        const user = req.user;
        const { transactionId } = req.params;

        if(!user){
            return res.status(401).json({ Error: true, Message: "Unauthorized || user not found" });
        }

        // if(!user?.isKYCVerified) {
        //     return res.status(403).json({Error: true, Message: "Forbidden || KYC not verified" });
        // }

        if(!user?.EmailVerif) {
            return res.status(403).json({Error: true, Message: "Forbidden || Email not verified" });
        }

        if(!user?.isprofileVerified) {
            return res.status(403).json({Error: true, Message: "Forbidden || Profile not verified" });
        }

        if(!transactionId) {
            return res.status(400).json({ Error: true, Message: "Bad Request || transactionId is required" });
        }
        const transaction = await transactionModel.findOne({ 
            _id: transactionId, 
            userId: user._id 
        }).lean();

        if(!transaction) {
            return res.status(404).json({ Error: true, Message: "Transaction not found" });
        }

         console.log('=== TRANSACTION DETAILS RETRIEVED ===');
        console.log(`User: ${user.FirstName} ${user.LastName}`);
        console.log(`Transaction: ${transaction.reference}`);
        console.log(`Amount: ₦${transaction.amount.toLocaleString()}`);
        console.log(`Status: ${transaction.status}`);
        console.log('=====================================');

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: 'Transaction details retrieved successfully',
            Data: transaction
        });

    } catch (error) {
        console.error('Error fetching transaction details:', error);
        return res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Failed to retrieve transaction details',
            Data: {
                error: ErrorDisplay(error).message || 'An unexpected error occurred'
            }
        });
    }
}


// get user transaction summary
const getUserTransactionSummary = async(req, res) => {
    try {
        const user = req.user;

        if(!user){
            return res.status(401).json({ Error: true, Message: "Unauthorized || user not found" });
        }

        // if(!user?.isKYCVerified) {
        //     return res.status(403).json({Error: true, Message: "Forbidden || KYC not verified" });
        // }

        if(!user?.EmailVerif) {
            return res.status(403).json({Error: true, Message: "Forbidden || Email not verified" });
        }

        if(!user?.isprofileVerified) {
            return res.status(403).json({Error: true, Message: "Forbidden || Profile not verified" });
        }

        const {period = '30'} = req.query; // Default to last 30 days

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(period));

        const summary = await transactionModel.aggregate([
            {
                $match:{
                    userId: new mongoose.Types.ObjectId(user._id),
                    createdAt: { $gte: startDate }
                },
            },
            { 
                $group:{
                    _id: {type: '$type', currency: '$currency'},
                    totalAmount: {$sum: '$amount'},
                    successfulAmount: {
                        $sum: {$cond: [{$eq: ['$status', 'success']}, '$amount', 0]}
                    },
                    successfulCount: {
                        $sum: {$cond: [{$eq: ['$status', 'success']}, 1, 0]}
                    },
                    totalFees:{
                        $sum: {$ifNull: ['$metadata.fee', 0]}
                    }
                }   
            },
            {
                $group:{
                    _id: '$_id.type',
                    currencies: {
                        $push: {
                            currency: '$_id.currency',
                            totalAmount: '$totalAmount',
                            count: '$count',
                            successfulAmount: '$successfulAmount',
                            successfulCount: '$successfulCount',
                            totalFees: '$totalFees'
                        }
                    },
                    overallAmount: {$sum: '$totalAmount'},
                    overallcount: {$sum: '$count'},
                }
            }
        ]);
        /// Get all user wallets (NGN and USD if they exist)
        const userWallets = await walletModel.find({ userId: user._id }, 'balance currency').lean();

            console.log('=== USER TRANSACTION SUMMARY ===');
        console.log(`User: ${user.FirstName} ${user.LastName}`);
        console.log(`Period: Last ${period} days`);
        console.log(`User Wallets:`, userWallets.map(w => `${w.currency}: ${w.balance?.toLocaleString() || '0'}`));
        console.log('================================');

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: 'Transaction summary retrieved successfully',
            Data: {
                period: `Last ${period} days`,
                wallets: userWallets.map(wallet => ({
                    currency: wallet.currency,
                    balance: wallet.balance || 0
                })),
                summary
            }
        })

    } catch (error) {
        console.error('Error fetching transaction summary:', error);
        return res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Failed to retrieve transaction summary',
            Data: {
                error: ErrorDisplay(error).message || 'An unexpected error occurred'
            }
        });
    }
}

module.exports = {
    getTransactionHistory,
    getSingleTransaction,
    getUserTransactionSummary
};