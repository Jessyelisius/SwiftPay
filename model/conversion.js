const { default: mongoose } = require("mongoose");


const ConversionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    fromCurrency: {
        type: String,
        enum: ['NGN', 'USD', 'BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'],
        required: true
    },
    toCurrency: {
        type: String,
        enum: ['NGN', 'USD', 'BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'],
        required: true
    },
    fromAmount: {
        type: Number,
        required: true
    },
    toAmount: {
        type: Number,
        required: true
    },
    conversionRate: {
        type: Number,
        required: true
    },
    priceSource: {
        type: String,
        default: 'CoinGecko'
    },
    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        required: true
    },
    status: {
        type: String,
        enum: ['completed', 'failed', 'reversed'],
        default: 'completed'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Conversion', ConversionSchema);
ConversionSchema.index({ userId: 1, createdAt: -1 });
ConversionSchema.index({ fromCurrency: 1, toCurrency: 1 });
