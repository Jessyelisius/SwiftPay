const conversion = require("../../model/conversion");
const priceHistoryModel = require("../../model/priceHistory.model");
const transactionModel = require("../../model/transactionModel");
const { calculateTransactionFee } = require("../../utils/random.util");
const { getRate, convertCurrency, getPrices } = require("./conversion");
const { hasSufficientBalance, getBalance, updateBalance } = require("./walletService");
const { v4: uuidv4 } = require('uuid');


const processConversion = async(userId, fromCurrency, toCurrency, amount) => {
    try {

        //validate user input
        if(!userId || !fromCurrency || !toCurrency || !amount){
            throw new Error("All fields are required: userId, amount, fromCurrency, toCurrency");
        }
        // Fetch the user object from database
        const user = await userModel.findById(userId);

        if(!user) {
            throw new Error("Unauthorized || User not found");
        }
        if(!user.isKycVerified) {
        throw new Error("Forbidden || KYC not verified");
        }

        if(!user.EmailVerif) {
        throw new Error("Forbidden || Email not verified");
        }

        if(amount <= 0){
            throw new Error("Amount must be greater than 0");
        }
        if (fromCurrency === toCurrency) {
            throw new Error('Cannot convert to the same currency');
        }
        //calculate conversion fee using the function
        let feeType;
        if(fromCurrency === 'USD' && toCurrency === 'NGN'){
            feeType = 'usd_to_ngn';
        }else if(fromCurrency === 'NGN' && toCurrency === 'USD'){
            feeType = 'ngn_to_usd';
        }else if(['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'].includes(fromCurrency) && toCurrency === 'NGN'){
            feeType = 'coin_to_ngn';
        }else {
            feeType = 'usd_to_ngn'; // Default for crypto conversions
        }

        const conversionFee = calculateTransactionFee(feeType, amount);
        const totalDeduction = amount + (fromCurrency === 'NGN' ? conversionFee : 0)

        //check for sufficient balance + feeco
        const requiredBalance = fromCurrency === 'NGN' ? totalDeduction : amount;
        const hasBalance = await hasSufficientBalance(userId, fromCurrency, requiredBalance);
        if(!hasBalance){
            const currentBalance = await getBalance(userId, fromCurrency);
            throw new Error(`Insufficient ${fromCurrency} balance. Available: ${currentBalance}, Required: ${requiredBalance} (including fee: ${conversionFee})`);
        }

        // / Get conversion rate and calculate converted amount
        const conversionRate = await getRate(fromCurrency, toCurrency);
        const convertedAmount = await convertCurrency(amount, fromCurrency, toCurrency);

        //generate transaction reference
        const reference = `CONV_${Date.now()}_${uuidv4().slice(0, 8)}`;

        //create transaction record
        const transaction = new transactionModel({
            userId,
            amount: convertedAmount,
            currency: toCurrency,
            method: 'conversion',
            type: 'conversion',
            status: 'processing',
            reference,
            cryptoDetails:{
                fromCurrency,
                toCurrency,
                conversionRate,
                fromAmount: amount,
                toAmount: convertedAmount,
                conversionFee: conversionFee,
                feeType: feeType
            },
            metadata:{
                conversionFee: conversionFee,
                feeType: feeType,
                feeDeductedFrom: fromCurrency === 'NGN' ? fromCurrency : 'NGN'
            }
        });

        await transaction.save();
        try {
            
            //update balances - subtract from source, add to destination
            await updateBalance(userId, fromCurrency, amount, 'subtract')
            await updateBalance(userId, toCurrency, amount, 'add');

            // Deduct conversion fee (always from NGN balance)
            if(conversionFee > 0){
                if (fromCurrency === 'NGN') {

                    // / Fee already included in amount deduction above
                    await updateBalance(userId, 'NGN', conversionFee, 'subtract');
                }else{
                    // Deduct fee from NGN balance separately
                    const hasNgnBalance = await hasSufficientBalance(userId, 'NGN', conversionFee);
                    if (!hasNgnBalance) {
                        // If no NGN balance, deduct equivalent from converted amount
                        const feeInTargetCurrency = await convertCurrency(conversionFee, 'NGN', toCurrency);
                        await updateBalance(userId, toCurrency, feeInTargetCurrency, 'subtract');
                        transaction.metadata.feeDeductedFrom = toCurrency;
                        transaction.metadata.feeInTargetCurrency = feeInTargetCurrency;
                    } else {
                        await updateBalance(userId, 'NGN', conversionFee, 'subtract');
                    }
                }
            }
            //save conversion history
            const conversionRecord = await saveConversionHistory({
                userId,
                fromCurrency,
                toCurrency,
                fromAmount: amount,
                toAmount: convertedAmount,
                conversionFee,
                transactionId: transaction._id,
                conversionFee
            });

            //update transaction status to success
            transaction.status = 'success';
            await transaction.save();

            return {
                success: true,
                Error: false,
                Data:{
                    transaction,
                    conversionRecord,
                    fromAmount: amount,
                    fromCurrency,
                    toAmount: convertedAmount,
                    toCurrency,
                    rate: conversionRate,
                    conversionFee,
                    feeType,
                    reference
                }
            };
        } catch (balanceError) {
            // Rollback transaction on balance update failure
            console.log('error processing', error);
            transaction.status = 'failed';
            await transaction.save();
            throw balanceError;
        }

    } catch (error) {
        console.error('Error processing conversion:', error.message);
        throw new Error(`Conversion failed: ${error.message}`);
    }
};

//save conversion to history
const saveConversionHistory = async(conversionData) => {
    try {
        const{
            userId,
            fromCurrency,
            toCurrency,
            fromAmount,
            toAmount,
            conversionRate,
            transactionId,
            conversionFee = 0
        } = conversionData;

        const conversion = new conversion({
            userId,
            fromCurrency,
            toCurrency,
            fromAmount,
            toAmount,
            conversionRate,
            transactionId,
            status: 'completed',
            metadata:{
                conversionFee: conversionFee
            }
        });
        await conversion.save();
        return conversion;

    } catch (error) {
        console.error('Error saving conversion history:', error.message);
        throw new Error(`Failed to save conversion history: ${error.message}`);
    }
}

//get conversion history for user;
const getConversionHistory = async (userId, limit = 20, page = 1) => {
    try {
        const skip = (page - 1) * limit;
        
        const conversions = await conversion.find({ userId })
            .populate('transactionId', 'reference status createdAt')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip);

        const total = await conversion.countDocuments({ userId });

        return {
            conversions,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };

    } catch (error) {
        console.error('Error getting conversion history:', error.message);
        throw new Error(`Failed to get conversion history: ${error.message}`);
    }
};

// Save current prices to history (for compliance/analytics)
const savePriceHistory = async () => {
    try {
        const prices = await getPrices();
        const priceRecords = [];

        for (const [currency, priceData] of Object.entries(prices)) {
            if (priceData.usd && priceData.ngn) {
                const priceHistory = new priceHistoryModel({
                    currency,
                    prices: {
                        usd: priceData.usd,
                        ngn: priceData.ngn
                    },
                    source: 'CoinGecko'
                });

                priceRecords.push(priceHistory);
            }
        }

        if (priceRecords.length > 0) {
            await priceHistoryModel.insertMany(priceRecords);
        }

        return priceRecords;

    } catch (error) {
        console.error('Error saving price history:', error.message);
        throw new Error(`Failed to save price history: ${error.message}`);
    }
};

// Get rate with fallback to database
const getRateWithFallback = async (fromCurrency, toCurrency) => {
    try {
        // Try to get live rate first
        return await getRate(fromCurrency, toCurrency);
    } catch (error) {
        console.log('Live rate failed, checking price history...');
        
        // Fallback to recent price history
        const recentPrice = await priceHistoryModel.findOne({
            currency: fromCurrency
        }).sort({ timestamp: -1 });

        if (recentPrice) {
            if (toCurrency === 'USD') {
                return recentPrice.prices.usd;
            } else if (toCurrency === 'NGN') {
                return recentPrice.prices.ngn;
            }
        }

        throw new Error('No rate available from live API or price history');
    }
};

// Get conversion quote with fees (without executing)
const getConversionQuote = async (amount, fromCurrency, toCurrency) => {
    try {
        const rate = await getRateWithFallback(fromCurrency, toCurrency);
        const convertedAmount = amount * rate;

        // Calculate conversion fee
        let feeType;
        if (fromCurrency === 'USD' && toCurrency === 'NGN') {
            feeType = 'usd_to_ngn';
        } else if (fromCurrency === 'NGN' && toCurrency === 'USD') {
            feeType = 'ngn_to_usd';
        } else if (['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'].includes(fromCurrency) && toCurrency === 'NGN') {
            feeType = 'coin_to_ngn';
        } else {
            feeType = 'usd_to_ngn'; // Default for crypto conversions
        }

        const conversionFee = calculateTransactionFee(feeType, amount);

        return {
            Error:false,
            Message:"conversion quote with fees",
            Data:{
                fromAmount: amount,
                fromCurrency,
                toAmount: convertedAmount,
                toCurrency,
                rate,
                conversionFee,
                feeType,
                netAmount: toCurrency === 'NGN' ? convertedAmount : convertedAmount, // Fee handled separately
                timestamp: new Date(),
                valid: true
            }
        };

    } catch (error) {
        console.error('Error getting conversion quote:', error.message);
        throw new Error(`Failed to get quote: ${error.message}`);
    }
};


module.exports = {
    processConversion,
    saveConversionHistory,
    getConversionHistory,
    savePriceHistory,
    getRateWithFallback,
    getConversionQuote,
    // testConversionOperations
};