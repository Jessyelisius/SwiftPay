const conversionService = require('./conversion');
const conversionServiceFuncs = require('./conversionService');
const walletServiceFuncs = require('./walletService');
const cryptoTransferServiceFuncs = require('./cryptoTransferService');

// fetchUsdToNgnRate
const fetchUsdToNgnRate = async (req, res) => {
    try {
        const rate = await conversionService.fetchUsdToNgnRate();
        return res.status(200).json({
            Error: false,
            Message: "Rate fetched successfully",
            Data: { rate, timestamp: new Date() }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

//fetch cryptoprices
// const fetchCryptoPrices = async (req, res) => {
//     try {
//         const prices = await conversionService.fetchCryptoPrices();
//         return res.status(200).json({
//             Error: false,
//             Message: "Prices fetched successfully",
//             Data: prices
//         });
//     }catch(error) {
//         return res.status(500).json({
//             Error: true,
//             Message: error.message
//         });
//     }
// }

// getPrices
const getPrices = async (req, res) => {
    try {
        const prices = await conversionService.getPrices();
        return res.status(200).json({
            Error: false,
            Message: "Prices fetched successfully",
            Data: prices
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// getConversionQuote
const getConversionQuote = async (req, res) => {
    try {
        const { amount, fromCurrency, toCurrency } = req.query;
        
        if (!amount || !fromCurrency || !toCurrency) {
            return res.status(400).json({
                Error: true,
                Message: "amount, fromCurrency, and toCurrency are required"
            });
        }

        const quote = await conversionServiceFuncs.getConversionQuote(
            parseFloat(amount), 
            fromCurrency.toUpperCase(), 
            toCurrency.toUpperCase()
        );
        return res.status(200).json(quote);
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// processConversion
const processConversion = async (req, res) => {
    try {
        const userId = req.user._id;
        const { amount, fromCurrency, toCurrency, transactionPin } = req.body;

        if (!amount || !fromCurrency || !toCurrency) {
            return res.status(400).json({
                Error: true,
                Message: "amount, fromCurrency, and toCurrency are required"
            });
        }

        const result = await conversionServiceFuncs.processConversion(
            userId, 
            fromCurrency.toUpperCase(), 
            toCurrency.toUpperCase(), 
            parseFloat(amount)
        );
        return res.status(200).json(result);
    } catch (error) {
        return res.status(400).json({
            Error: true,
            Message: error.message
        });
    }
};

// getConversionHistory
const getConversionHistory = async (req, res) => {
    try {
        const userId = req.user._id;
        const { limit = 20, page = 1 } = req.query;

        const history = await conversionServiceFuncs.getConversionHistory(userId, parseInt(limit), parseInt(page));
        return res.status(200).json({
            Error: false,
            Message: "History fetched successfully",
            Data: history
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// createWallet
const createWallet = async (req, res) => {
    try {
        const userId = req.user._id;
        const wallet = await walletServiceFuncs.createWallet(userId);
        return res.status(201).json({
            Error: false,
            Message: "Wallet created successfully",
            Data: wallet
        });
    } catch (error) {
        return res.status(400).json({
            Error: true,
            Message: error.message
        });
    }
};

// getWallet
const getWallet = async (req, res) => {
    try {
        const userId = req.user._id;
        const wallet = await walletServiceFuncs.getWalletSummary(userId);
        return res.status(200).json({
            Error: false,
            Message: "Wallet fetched successfully",
            Data: wallet
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// getBalance
const getBalance = async (req, res) => {
    try {
        const userId = req.user._id;
        const { currency } = req.params;

        const balance = await walletServiceFuncs.getBalance(userId, currency.toUpperCase());
        return res.status(200).json({
            Error: false,
            Message: "Balance fetched successfully",
            Data: { currency: currency.toUpperCase(), balance }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// addExternalWallet
const addExternalWallet = async (req, res) => {
    try {
        const userId = req.user._id;
        const { currency, address, label, network, transactionPin } = req.body;

        if (!currency || !address || !label) {
            return res.status(400).json({
                Error: true,
                Message: "currency, address, and label are required"
            });
        }

        const wallet = await walletServiceFuncs.addExternalWallet(userId, {
            currency: currency.toUpperCase(),
            address,
            label,
            network
        });

        return res.status(201).json({
            Error: false,
            Message: "Wallet added successfully",
            Data: wallet
        });
    } catch (error) {
        return res.status(400).json({
            Error: true,
            Message: error.message
        });
    }
};

// getExternalWallet
const getExternalWallet = async (req, res) => {
    try {
        const userId = req.user._id;
        const { currency } = req.query;

        const wallets = await walletServiceFuncs.getExternalWallet(userId, currency ? currency.toUpperCase() : null);
        return res.status(200).json({
            Error: false,
            Message: "Wallets fetched successfully",
            Data: wallets
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// validateWalletAddress
const validateWalletAddress = async (req, res) => {
    try {
        const { currency, address, network } = req.body;

        if (!currency || !address) {
            return res.status(400).json({
                Error: true,
                Message: "currency and address are required"
            });
        }

        const isValid = cryptoTransferServiceFuncs.validateWalletAddress(currency.toUpperCase(), address, network);
        return res.status(200).json({
            Error: false,
            Message: "Validation completed",
            Data: { currency: currency.toUpperCase(), address, isValid, network }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// processCryptoWithdrawal
const processCryptoWithdrawal = async (req, res) => {
    try {

        const userId = req.user._id;
        const { amount, currency, walletAddress, network, transactionPin } = req.body;

        if (!amount || !currency || !walletAddress) {
            return res.status(400).json({
                Error: true,
                Message: "amount, currency, and walletAddress are required"
            });
        }

        const result = await cryptoTransferServiceFuncs.processCryptoWithdrawal(
            userId, 
            parseFloat(amount), 
            currency.toUpperCase(), 
            walletAddress, 
            network
        );
        return res.status(200).json(result);
    } catch (error) {
        return res.status(400).json({
            Error: true,
            Message: error.message
        });
    }
};

// getWithdrawalHistory
const getWithdrawalHistory = async (req, res) => {
    try {
        const userId = req.user._id;
        const { currency, limit = 20, page = 1 } = req.query;

        const history = await cryptoTransferServiceFuncs.getWithdrawalHistory(
            userId, 
            currency ? currency.toUpperCase() : null, 
            parseInt(limit), 
            parseInt(page)
        );
        return res.status(200).json({
            Error: false,
            Message: "History fetched successfully",
            Data: history
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// checkWithdrawalStatus
const checkWithdrawalStatus = async (req, res) => {
    try {
        const { reference } = req.params;
        const status = await cryptoTransferServiceFuncs.checkWithdrawalStatus(reference);
        return res.status(200).json({
            Error: false,
            Message: "Status fetched successfully",
            Data: status
        });
    } catch (error) {
        return res.status(404).json({
            Error: true,
            Message: error.message
        });
    }
};

// supportedNetworks
const supportedNetworks = async (req, res) => {
    try {
        const { currency } = req.params;
        const networks = cryptoTransferServiceFuncs.supportedNetworks[currency.toUpperCase()];

        if (!networks) {
            return res.status(404).json({
                Error: true,
                Message: `Currency ${currency} not supported`
            });
        }

        return res.status(200).json({
            Error: false,
            Message: "Networks fetched successfully",
            Data: { currency: currency.toUpperCase(), networks }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// calculateNetworkFee
const calculateNetworkFee = async (req, res) => {
    try {
        const { currency } = req.params;
        const { network } = req.query;

        const fee = cryptoTransferServiceFuncs.calculateNetworkFee(currency.toUpperCase(), network);
        return res.status(200).json({
            Error: false,
            Message: "Fee calculated successfully",
            Data: { currency: currency.toUpperCase(), network: network || 'default', fee }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// savePriceHistory
const savePriceHistory = async (req, res) => {
    try {
        const records = await conversionServiceFuncs.savePriceHistory();
        return res.status(201).json({
            Error: false,
            Message: "Price history saved successfully",
            Data: { count: records.length }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

// getRate
const getRate = async (req, res) => {
    try {
        const { from, to } = req.params;
        const rate = await conversionService.getRate(from.toUpperCase(), to.toUpperCase());
        return res.status(200).json({
            Error: false,
            Message: "Rate fetched successfully",
            Data: { from: from.toUpperCase(), to: to.toUpperCase(), rate }
        });
    } catch (error) {
        return res.status(500).json({
            Error: true,
            Message: error.message
        });
    }
};

module.exports = {
    fetchUsdToNgnRate,
    // fetchCryptoPrices,
    getPrices,
    getConversionQuote,
    processConversion,
    getConversionHistory,
    createWallet,
    getWallet,
    getBalance,
    addExternalWallet,
    getExternalWallet,
    validateWalletAddress,
    processCryptoWithdrawal,
    getWithdrawalHistory,
    checkWithdrawalStatus,
    supportedNetworks,
    calculateNetworkFee,
    savePriceHistory,
    getRate
};