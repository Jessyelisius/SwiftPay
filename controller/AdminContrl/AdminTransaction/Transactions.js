const transactionModel = require("../../../model/transactionModel");
const walletModel = require("../../../model/walletModel");
const { ErrorDisplay } = require("../../../utils/random.util");


// ADMIN: GET ALL TRANSACTIONS
const getAllTransactions = async (req, res) => {
    try {
        const admin = req.admin; // Assuming you have admin middleware

        if (!admin) {
            return res.status(401).json({ 
                Access: false, 
                Error: true, 
                Message: "Unauthorized || admin not found" 
            });
        }

        const {
            page = 1,
            limit = 20,
            userId,
            type,
            status,
            method,
            currency,
            startDate,
            endDate,
            minAmount,
            maxAmount,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            search // For searching by reference
        } = req.query;

        // Build filter object
        const filter = {};

        // Add optional filters
        if (userId) filter.userId = userId;
        if (type) filter.type = type;
        if (status) filter.status = status;
        if (method) filter.method = method;
        if (currency) filter.currency = currency;

        // Amount range filter
        if (minAmount || maxAmount) {
            filter.amount = {};
            if (minAmount) filter.amount.$gte = parseFloat(minAmount);
            if (maxAmount) filter.amount.$lte = parseFloat(maxAmount);
        }

        // Date range filter
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        // Search filter (by reference or korapay reference)
        if (search) {
            filter.$or = [
                { reference: { $regex: search, $options: 'i' } },
                { korapayReference: { $regex: search, $options: 'i' } }
            ];
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitNum = parseInt(limit);

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Execute queries
        const [transactions, totalCount] = await Promise.all([
            transactionModel.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            transactionModel.countDocuments(filter)
        ]);

        // Calculate pagination info
        const totalPages = Math.ceil(totalCount / limitNum);

        // Calculate overall statistics by currency
        const overallStats = await transactionModel.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: '$currency',
                    totalAmount: { $sum: '$amount' },
                    totalTransactions: { $sum: 1 },
                    successfulAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'success'] }, '$amount', 0] }
                    },
                    pendingAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
                    },
                    failedAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'failed'] }, '$amount', 0] }
                    },
                    totalRevenue: {
                        $sum: { $ifNull: ['$metadata.fee', 0] }
                    },
                    successfulCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
                    },
                    pendingCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                    },
                    failedCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                    }
                }
            }
        ]);

        // Format stats by currency
        const statsByCurrency = {};
        let totalPlatformRevenue = 0;
        overallStats.forEach(stat => {
            const curr = stat._id || 'NGN';
            statsByCurrency[curr] = {
                totalAmount: stat.totalAmount,
                totalTransactions: stat.totalTransactions,
                successfulAmount: stat.successfulAmount,
                pendingAmount: stat.pendingAmount,
                failedAmount: stat.failedAmount,
                totalRevenue: stat.totalRevenue,
                successfulCount: stat.successfulCount,
                pendingCount: stat.pendingCount,
                failedCount: stat.failedCount
            };
            totalPlatformRevenue += stat.totalRevenue;
        });

        console.log('=== ADMIN: ALL TRANSACTIONS RETRIEVED ===');
        console.log(`Admin: ${admin.firstName || admin.email}`);
        console.log(`Total transactions found: ${totalCount}`);
        console.log(`Page ${page} of ${totalPages}`);
        console.log(`Currency filter: ${currency || 'ALL'}`);
        console.log(`Total Platform Revenue: ${totalPlatformRevenue.toLocaleString()}`);
        console.log(`Stats by currency:`, statsByCurrency);
        console.log('=========================================');

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: 'All transactions retrieved successfully',
            Data: {
                transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalCount,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                    limit: limitNum
                },
                statistics: statsByCurrency,
                totalPlatformRevenue
            }
        });

    } catch (error) {
        console.error('🧨 Admin Error fetching all transactions:', error);
        return res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Failed to retrieve all transactions',
            Data: {
                error: ErrorDisplay(error).message || 'An unexpected error occurred'
            }
        });
    }
};



// ADMIN: GET TRANSACTIONS FOR SPECIFIC USER
const getUserTransactionsAdmin = async (req, res) => {
    try {
        const admin = req.admin;
        const { userId } = req.params;

        if (!admin) {
            return res.status(401).json({ 
                Access: false, 
                Error: true, 
                Message: "Unauthorized || admin not found" 
            });
        }

        if (!userId) {
            return res.status(400).json({ 
                Access: false, 
                Error: true, 
                Message: "Bad Request || User ID is required" 
            });
        }

        const {
            page = 1,
            limit = 20,
            type,
            status,
            currency,
            startDate,
            endDate
        } = req.query;

        // Build filter object
        const filter = { userId };

        if (type) filter.type = type;
        if (status) filter.status = status;

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitNum = parseInt(limit);

        const [transactions, totalCount] = await Promise.all([
            transactionModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            transactionModel.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(totalCount / limitNum);

        // Get user wallet info for context (both NGN and USD if available)
        const userWallets = await walletModel.find({ userId }, 'balance currency').lean();

        console.log('=== ADMIN: USER TRANSACTIONS RETRIEVED ===');
        console.log(`Admin: ${admin.firstName || admin.email}`);
        console.log(`Target User ID: ${userId}`);
        console.log(`Total transactions found: ${totalCount}`);
        console.log(`Currency filter: ${currency || 'ALL'}`);
        console.log(`User Wallets:`, userWallets.map(w => `${w.currency}: ${w.balance?.toLocaleString() || '0'}`));
        console.log('==========================================');

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: 'User transactions retrieved successfully',
            Data: {
                userId,
                userWallets: userWallets.map(wallet => ({
                    currency: wallet.currency,
                    balance: wallet.balance || 0
                })),
                transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalCount,
                    limit: limitNum
                }
            }
        });

    } catch (error) {
        console.error('🧨 Admin Error fetching user transactions:', error);
        return res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Failed to retrieve user transactions',
            Data: {
                error: ErrorDisplay(error).message || 'An unexpected error occurred'
            }
        });
    }
};

// ADMIN: GET ANALYTICS/DASHBOARD DATA
const getTransactionAnalytics = async (req, res) => {
    try {
        const admin = req.admin;

        if (!admin) {
            return res.status(401).json({ 
                Access: false, 
                Error: true, 
                Message: "Unauthorized || admin not found" 
            });
        }

        const { period = '30' } = req.query;
        const days = parseInt(period);
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get daily transaction volumes by currency
        const dailyStats = await transactionModel.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                        status: "$status",
                        currency: "$currency"
                    },
                    count: { $sum: 1 },
                    amount: { $sum: "$amount" },
                    fees: { $sum: { $ifNull: ["$metadata.fee", 0] } }
                }
            },
            {
                $group: {
                    _id: { date: "$_id.date", currency: "$_id.currency" },
                    successful: {
                        $sum: { $cond: [{ $eq: ["$_id.status", "success"] }, "$count", 0] }
                    },
                    pending: {
                        $sum: { $cond: [{ $eq: ["$_id.status", "pending"] }, "$count", 0] }
                    },
                    failed: {
                        $sum: { $cond: [{ $eq: ["$_id.status", "failed"] }, "$count", 0] }
                    },
                    totalAmount: { $sum: "$amount" },
                    totalFees: { $sum: "$fees" }
                }
            },
            { $sort: { "_id.date": 1, "_id.currency": 1 } }
        ]);

        // Get transaction type breakdown by currency
        const typeBreakdown = await transactionModel.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate },
                    status: 'success'
                }
            },
            {
                $group: {
                    _id: { type: "$type", currency: "$currency" },
                    count: { $sum: 1 },
                    totalAmount: { $sum: "$amount" },
                    totalFees: { $sum: { $ifNull: ["$metadata.fee", 0] } }
                }
            }
        ]);

        // Get method breakdown by currency
        const methodBreakdown = await transactionModel.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate },
                    status: 'success'
                }
            },
            {
                $group: {
                    _id: { method: "$method", currency: "$currency" },
                    count: { $sum: 1 },
                    totalAmount: { $sum: "$amount" },
                    totalFees: { $sum: { $ifNull: ["$metadata.fee", 0] } }
                }
            }
        ]);

        // Calculate total revenue from fees by currency
        const revenueByurrency = {};
        dailyStats.forEach(day => {
            const currency = day._id.currency || 'NGN';
            if (!revenueByurrency[currency]) revenueByurrency[currency] = 0;
            revenueByurrency[currency] += day.totalFees;
        });

        const totalRevenue = Object.values(revenueByurrency).reduce((sum, revenue) => sum + revenue, 0);

        console.log('=== ADMIN: ANALYTICS DATA RETRIEVED ===');
        console.log(`Admin: ${admin.firstName || admin.email}`);
        console.log(`Period: Last ${days} days`);
        console.log(`Total Platform Revenue: ${totalRevenue.toLocaleString()}`);
        console.log(`Revenue by Currency:`, revenueByurrency);
        console.log(`Daily stats entries: ${dailyStats.length}`);
        console.log(`======================================`);
        console.log(`Period: Last ${days} days`);
        console.log(`Total Platform Revenue: ₦${totalRevenue.toLocaleString()}`);
        console.log(`Daily stats entries: ${dailyStats.length}`);
        console.log(`======================================`);

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: 'Analytics data retrieved successfully',
            Data: {
                period: `Last ${days} days`,
                totalPlatformRevenue: totalRevenue,
                dailyStats,
                typeBreakdown,
                methodBreakdown
            }
        });

    } catch (error) {
        console.error('🧨 Admin Error fetching analytics:', error);
        return res.status(500).json({
            Access: false,
            Error: true,
            Message: 'Failed to retrieve analytics data',
            Data: {
                error: ErrorDisplay(error).message || 'An unexpected error occurred'
            }
        });
    }
};

module.exports = {
    getAllTransactions,
    getUserTransactionsAdmin,
    getTransactionAnalytics,
}