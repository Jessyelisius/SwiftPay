const { default: mongoose } = require("mongoose");

const PriceHistorySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        // required: true
    },
    currency: {
        type: String,
        enum: ['BTC', 'ETH', 'LTC', 'BNB', 'ADA', 'XRP', 'USDT', 'USDC'],
        required: true
    },
    prices: {
        usd: {
            type: Number,
            required: true
        },
        ngn: {
            type: Number,
            required: true
        }
    },
    source: {
        type: String,
        default: 'CoinGecko'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('PriceHistory', PriceHistorySchema);
PriceHistorySchema.index({ currency: 1, timestamp: -1 });
PriceHistorySchema.index({ timestamp: 1 }); // For cleanup of old data
