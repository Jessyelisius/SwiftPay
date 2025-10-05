const { default: axios } = require("axios");
require('dotenv').config();

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const OPENEXCHANGE_BASE_URL = 'https://openexchangerates.org/api';

const supportedCoins = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    LTC: 'litecoin',
    BNB: 'binancecoin',
    ADA: 'cardano',
    XRP: 'ripple',
    USDT: 'tether',
    USDC: 'usd-coin'
}

let priceCache = {};
let lastFetch = 0;
const cacheExpiry = 30000 //30 secs

// getting USD -> NGN conversion from Open ExchangeRates
const fetchUsdToNgnRate = async() => {
    try {
        const appId = '7b5a3b5daed7483191a6d40692e14962';
        const response = await axios.get(`${OPENEXCHANGE_BASE_URL}/latest.json?app_id=${appId}&symbols=NGN`);
        const data = response.data;
        // {
        //     params:{
        //         app_id: appId,
        //         symbols: 'NGN'
        //     }
        // };
        
        const rate = data?.rates?.NGN;
        if(!rate) throw new Error('rate is missing');
        return rate;

    } catch (error) {
        console.log('Error fetching rate', error);
        throw new Error("Failed to fetch exchange rate");
    }
};

//crypto prices from Coin gecko
const fetchCryptoPrices = async() => {
    try {
        const coinIds = Object.values(supportedCoins).join(',');
        const {data} = await axios.get(`${COINGECKO_BASE_URL}/simple/price`,{
            params:{
                ids: coinIds,
                vs_currencies: 'usd,ngn'
            }
        });

        const prices = {};
        for(const[Symbol, coinId] of Object.entries(supportedCoins)){
            if(data[coinId]){
                prices[Symbol] = {
                    usd: data[coinId].usd || 0,
                    ngn: data[coinId].ngn || 0
                }
            }
        }

        priceCache = prices;
        lastFetch = Date.now();

        return prices;

    } catch (error) {
        console.log('error fetching crypto prices', error);
        throw new Error("Failed to fetch crypto prices");
    }
};

//get the cached or refreshed crypto pricess
const getPrices = async() => {
    const now = Date.now();
    if(now - lastFetch > cacheExpiry){
        return await fetchCryptoPrices();
    }
    return priceCache;
}

//convert NGN -> USD
const convertNgnToUsd = async(ngn) => {
    const rate = await fetchUsdToNgnRate();
    return ngn / rate;
}

//convert USD -> NGN
const convertUsdToNgn = async(usd) => {
    const rate = await fetchUsdToNgnRate();
    return usd * rate;
}

//currency conversion
const convertCurrency = async(amount, from, to) => {
    if(typeof amount !== 'number' || amount <= 0){
        throw new Error("Amount must be a positive number");
    }

    const prices = await getPrices();

    if(from === 'NGN' && to === 'USD') return await convertNgnToUsd(amount);
    if(from === 'USD' && to === 'NGN') return await convertUsdToNgn(amount);

    //usd -> cryptocoin
    if(from === 'USD' && supportedCoins[to]){
        const rate = prices[to]?.usd;
        if(!rate) throw new Error(`No rate for ${to}`);
        return amount / rate;
    }

    //cryptocoin -> usd
    if(supportedCoins[from] && to === 'USD'){
        const rate = prices[from]?.usd;
        if(!rate) throw new Error(`No rate for ${from}`);
        return amount * rate;
    }

    //ngn -> usd -> cryptocoin
    if(from === 'NGN' && supportedCoins[to]){
        const usd = await convertNgnToUsd(amount);
        const rate = prices[to]?.usd;
        if(!rate) throw new Error(`No rate for ${to}`);
        return usd / rate; 
    }

    //cryptocoin -> usd -> ngn
    if(supportedCoins[from] && to === 'NGN'){
        const rate = prices[from]?.usd;
        if(!rate) throw new Error(`No rate for ${from}`);
        const usd = amount * rate;
        return await convertUsdToNgn(usd);
    }

    throw new Error(`Unsupported conversion ${from} to ${to}`);
    
}

const getRate = async(from, to) => await convertCurrency(1, from, to);


module.exports = {
    convertCurrency,
    fetchCryptoPrices,
    convertNgnToUsd,
    convertUsdToNgn,
    getRate,
    fetchUsdToNgnRate,
    getPrices,
}

// testconversion();
