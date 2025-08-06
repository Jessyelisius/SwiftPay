const walletModel = require("../../model/walletModel");
const { ErrorDisplay } = require("../../utils/random.util");


const createWallet = async(userId) => {
    try {

        //  const userid = userId;

        if(!userId) {
            throw new Error("Unauthorized || userId not found");
        }

        if(!userId?.isKYCVerified) {
           throw new Error("Forbidden || KYC not verified");
        }

        if(!userId?.EmailVerif) {
           throw new Error("Forbidden || Email not verified");
        }

        //check if wallet already exist
        const existingWallet = await walletModel.findOne({userId: userId});
        if (existingWallet) {
            throw new Error('Wallet already exists for this user');
        }

        const newWallet = new walletModel({
            userId,
            balance:{
                NGN:0,
                USD:0
            },
            cryptoBalances:{
                BTC: 0,
                ETH: 0,
                LTC: 0,
                BNB: 0,
                ADA: 0,
                XRP: 0,
                USDT: 0,
                USDC: 0
            }
        });

        await newWallet.save();
        return newWallet;
    } catch (error) {
        console.error('Error creating wallet:', ErrorDisplay(error).message);
        throw new Error(`Failed to create wallet: ${error.message}`);
    }
};

//get wallet by userId
const getWallet = async(userId) => {
    try {

        const wallet = await walletModel.findOne({userId});
        if (!wallet) {
            throw new Error('Wallet not found');
        }
        return wallet;
    } catch (error) {
        console.error('Error fetching wallet:', ErrorDisplay(error).message);
        throw new Error(`Failed to fetch wallet: ${error.message}`);
    }
};

//get specific balance from currency
const getBalance = async(userId, currency)=> {
    try {
        const wallet = await getWallet(userId);
        if(['NGN','USD'].includes(currency)){
            return wallet.balance[currency] || 0
        }else{
            return wallet.cryptoBalances[currency] || 0
        }
    } catch (error) {
         console.error('Error getting balance:', ErrorDisplay(error).message);
        throw new Error(`Failed to get ${currency} balance: ${error.message}`);
    }
};

//update wallet balance add or debit-minus
const updateBalance = async(userId, currency, amount, operation = 'add')=>{
    try {
        const wallet = await getWallet(userId);

        let currentBalance;
        if(['NGN', 'USD'].includes(currency)){
            currentBalance = wallet.balance[currency] || 0;
        }else{
            currentBalance = wallet.cryptoBalances[currency] || 0
        }

        let newBalance;
        if(operation === 'add'){
            newBalance = currentBalance + amount;
        }else if(operation === 'subtract'){
            newBalance = currentBalance - amount;
            if (newBalance < 0) {
                throw new Error(`Insufficient ${currency} balance. Available: ${currentBalance}, Required: ${amount}`);
            }
        }else{
            throw new Error('Invalid operation. Use "add" or "subtract"');
        }

        //update appropriate balance
        if(['NGN', 'USD'].includes(currency)){
            wallet.balance[currency] = newBalance;
        }else{
            wallet.cryptoBalances[currency] = newBalance;
        }
        await wallet.save();
        return wallet;

    } catch (error) {
        console.error('Error updating balance:', error.message);
        throw new Error(`Failed to update balance: ${error.message}`);
    }
};

// Check if user has sufficient balance
const hasSufficientBalance = async(userId, currency, amount) => {
    try {
        const currentBalance = await getBalance(userId, currency)
        return currentBalance >= amount;
    } catch (error) {
        console.error('Error checking balance:', error.message);
        return false;
    }
};

//add external wallet eg meta mask, trustwallet
const addExternalWallet = async(userId, walletData) => {
    try {
        const {currency, address, label, network} = walletData;
        if(!currency ||!address ||!label){
            throw new Error('Currency, address, and label are required');
        }
        const wallet = await getWallet(userId);

        // Check if address already exists
        const existingWallet = wallet.externalWallets.find(w => 
            w.currency === currency && w.address === address
        );
        
        if (existingWallet) {
            throw new Error('Wallet address already exists');
        }

        const newExternalWallet = {
            currency,
            address,
            label,
            network: network || null,
            addedAt: new Date(),
            isVerified: false
        };

        wallet.externalWallets.push(newExternalWallet);
        await wallet.save();

        return wallet;

    } catch (error) {
        console.error('Error adding external wallet:', error.message);
        throw new Error(`Failed to add external wallet: ${error.message}`);
    }
};

// Get external wallets for a currency for transactionss
const getExternalWallet = async(userId, currency = null) => {
    try {
        const wallet = await getWallet(userId);
        if (currency) {
            return wallet.externalWallets.filter(w => w.currency === currency);
        }
        
        return wallet.externalWallets;
    } catch (error) {
        console.error('Error getting external wallets:', error.message);
        throw new Error(`Failed to get external wallets: ${error.message}`);
    }
};

// Get wallet summary with all balances
const getWalletSummary = async(userId) => {
    try {
        const wallet = await getWallet(userId);
        return{
            userId: wallet.userId,
            fiatBalances: wallet.balance,
            cryptoBalances: wallet.cryptoBalances,
            externalWallets: wallet.externalWallets?.length,
            lastTransaction: wallet.lastTransaction,
            createdAt: wallet.createdAt
        }
    } catch (error) {
        console.error('Error getting wallet summary:', error.message);
        throw new Error(`Failed to get wallet summary: ${error.message}`);
    }
};

// Test wallet operations
// const testWalletOperations = async () => {
//     try {
//         console.log('🔄 Testing Wallet Service...\n');

//         // Test user ID (use a real ObjectId in production)
//         const testUserId = '64f7b1234567890123456789';

//         // Test 1: Create wallet
//         console.log('1. Creating wallet...');
//         try {
//             const wallet = await createWallet(testUserId);
//             console.log('✅ Wallet created successfully');
//         } catch (error) {
//             console.log('ℹ️ Wallet might already exist:', error.message);
//         }

//         // Test 2: Get wallet summary
//         console.log('\n2. Getting wallet summary...');
//         const summary = await getWalletSummary(testUserId);
//         console.log('✅ Wallet Summary:');
//         console.log(`   NGN: ₦${summary.fiatBalances.NGN.toLocaleString()}`);
//         console.log(`   USD: $${summary.fiatBalances.USD.toLocaleString()}`);
//         console.log(`   BTC: ${summary.cryptoBalances.BTC} BTC`);

//         // Test 3: Update balances
//         console.log('\n3. Adding test balance...');
//         await updateBalance(testUserId, 'NGN', 100000, 'add');
//         await updateBalance(testUserId, 'BTC', 0.001, 'add');
//         console.log('✅ Balances updated');

//         // Test 4: Check balance
//         console.log('\n4. Checking balances...');
//         const ngnBalance = await getBalance(testUserId, 'NGN');
//         const btcBalance = await getBalance(testUserId, 'BTC');
//         console.log(`✅ NGN Balance: ₦${ngnBalance.toLocaleString()}`);
//         console.log(`✅ BTC Balance: ${btcBalance} BTC`);

//         console.log('\n✅ All wallet tests completed successfully!');

//     } catch (error) {
//         console.error('❌ Wallet test failed:', error.message);
//     }
// };

// testWalletOperations();

module.exports = {
    createWallet,
    getWallet,
    getBalance,
    updateBalance,
    hasSufficientBalance,
    addExternalWallet,
    getExternalWallet,
    getWalletSummary
    // testWalletOperations
}