const transactionModel = require("../../model/transactionModel");
const { calculateTransactionFee } = require("../../utils/random.util");
const { v4: uuidv4 } = require('uuid');
const { updateBalance, addExternalWallet, hasSufficientBalance, getExternalWallet, getBalance } = require("./walletService");


//supported network for each cryptocurrency
const supportedNetworks = {
    BTC: ['Bitcoin'],
    ETH: ['Ethereum', 'ERC20'],
    LTC: ['Litecoin'],
    BNB: ['BSC', 'BEP20'],
    ADA: ['Cardano'],
    XRP: ['XRP Ledger'],
    USDT: ['Ethereum', 'ERC20', 'Tron', 'TRC20', 'BSC', 'BEP20'],
    USDC: ['Ethereum', 'ERC20', 'BSC', 'BEP20', 'Polygon']
};

// Validate crypto wallet address format (basic validation)
const validateWalletAddress = (currency, address, network = null) => {
    try {
        if(!address || typeof address !== 'string'){
            return false;
        }

        // Remove whitespace
        address = address.trim();

        // Basic validation patterns (you should use proper validation libraries in production)
        const patterns = {
            BTC: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/,
            ETH: /^0x[a-fA-F0-9]{40}$/,
            LTC: /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/,
            BNB: /^bnb[a-z0-9]{39}$|^0x[a-fA-F0-9]{40}$/,
            ADA: /^addr1[a-z0-9]{58}$/,
            XRP: /^r[a-zA-Z0-9]{24,34}$/,
            USDT: /^0x[a-fA-F0-9]{40}$|^T[A-Za-z1-9][1-9A-HJ-NP-Za-km-z]{33}$/,
            USDC: /^0x[a-fA-F0-9]{40}$/
        };
        const pattern = patterns[currency];
        if (!pattern) {
            return false;
        }

        return pattern.test(address);

    } catch (error) {
        console.error('Error validating address:', error.message);
        return false;
    }
};

//add external wallet with validation
const addExternalWalletWithValidation = async(userId, walletData) =>{
    try {
        const {currency, address, label, network} = walletData;

        // Validate required fields
        if (!currency || !address || !label) {
            throw new Error('Currency, address, and label are required');
        }
        if(!supportedNetworks[currency]){
            throw new Error(`Currency ${currency} is not supported`);
        }

        //validate network if provided
        if (network && !supportedNetworks[currency].includes(network)) {
            throw new Error(`Network ${network} is not supported for ${currency}`);
        }

         // Validate wallet address
        if (!validateWalletAddress(currency, address, network)) {
            throw new Error(`Invalid ${currency} wallet address format`);
        }

        // Add wallet using walletService
        const wallet = await addExternalWallet(userId, {
            currency,
            address: address.trim(),
            label,
            network: network || supportedNetworks[currency][0] // Default to first supported network
        });

        return wallet;

    } catch (error) {
        console.error('Error adding external wallet:', error.message);
        throw new Error(`Failed to add external wallet: ${error.message}`);
    }
};

// Process crypto withdrawal to external wallet (with fees)
const processCryptoWithdrawal = async (userId, amount, currency, walletAddress, network = null) => {
    try {
        // Validate input
        if (!userId || !amount || !currency || !walletAddress) {
            throw new Error('All fields are required: userId, amount, currency, walletAddress');
        }

        if (amount <= 0) {
            throw new Error('Amount must be greater than 0');
        }

        // Check if currency is supported
        if (!supportedNetworks[currency]) {
            throw new Error(`Currency ${currency} is not supported for withdrawal`);
        }

        // Validate wallet address
        if (!validateWalletAddress(currency, walletAddress, network)) {
            throw new Error(`Invalid ${currency} wallet address format`);
        }

        // Calculate network fee (blockchain fee)
        const networkFee = calculateNetworkFee(currency, network);
        
        // Calculate SwiftPay service fee for crypto withdrawal (using your fee system)
        // Treat crypto withdrawal as international transfer for fee calculation
        // const serviceFee = calculateTransactionFee('international_transfer', amount);
        
        const convertCurrency = require('./conversion');
        const amountInNgn = await convertCurrency(amount, currency, 'NGN');
        const serviceFeeInNgn = calculateTransactionFee('crypto_withdrawal', amountInNgn);

        // Convert service fee back to crypto for total deduction
        const serviceFeeInCrypto = await convertCurrency(serviceFeeInNgn, 'NGN', currency);

        const totalDeduction = amount + networkFee + serviceFeeInCrypto;

        // Check sufficient balance for amount + all fees
        const hasBalance = await hasSufficientBalance(userId, currency, totalDeduction);
        if (!hasBalance) {
            const currentBalance = await getBalance(userId, currency);
            throw new Error(`Insufficient ${currency} balance. Available: ${currentBalance}, Required: ${totalDeduction} (Amount: ${amount} + Network Fee: ${networkFee} + Service Fee: ${serviceFeeInCrypto} ${currency} [₦${serviceFeeInNgn}])`);
        }

        // Generate transaction reference
        const reference = `WITHDRAW_${currency}_${Date.now()}_${uuidv4().slice(0, 8)}`;

        // Create transaction record
        const transaction = new transactionModel({
            userId,
            amount,
            currency,
            method: 'crypto_transfer',
            type: 'withdrawal',
            status: 'processing',
            reference,
            cryptoDetails: {
                walletAddress: walletAddress.trim(),
                network: network || supportedNetworks[currency][0],
                gasFee: networkFee,
                // serviceFee: serviceFee,
                // totalFees: networkFee + serviceFee
                serviceFeeInCrypto: serviceFeeInCrypto,
                serviceFeeInNgn: serviceFeeInNgn,
                totalFees: networkFee + serviceFeeInCrypto
            },
            recipient: {
                walletAddress: walletAddress.trim()
            },
            metadata: {
                networkFee: networkFee,
                // serviceFee: serviceFee,
                // totalDeduction: totalDeduction,
                // feeType: 'international_transfer'
                serviceFeeInCrypto: serviceFeeInCrypto,
                serviceFeeInNgn: serviceFeeInNgn,
                totalDeduction: totalDeduction,
                feeType: 'crypto_withdrawal'
            }
        });

        await transaction.save();

        try {
            // Deduct total amount (amount + network fee + service fee)
            await updateBalance(userId, currency, totalDeduction, 'subtract');

            // In a real implementation, you would:
            // 1. Submit transaction to blockchain network
            // 2. Get transaction hash
            // 3. Update transaction with txHash
            
            // For now, we'll simulate successful processing
            const mockTxHash = `0x${uuidv4().replace(/-/g, '')}${Date.now().toString(16)}`;
            
            transaction.cryptoDetails.txHash = mockTxHash;
            transaction.status = 'success';
            await transaction.save();

            return {
                Error: false,
                Message: "transaction processed",
                Data:{
                    transaction,
                    amount,
                    currency,
                    walletAddress,
                    network: network || supportedNetworks[currency][0],
                    // networkFee,
                    // serviceFee,
                    // totalFees: networkFee + serviceFee,
                    networkFee: `${networkFee} ${currency}`,
                    serviceFee: `${serviceFeeInCrypto} ${currency} (₦${serviceFeeInNgn})`,
                    totalFees: `${networkFee + serviceFeeInCrypto} ${currency}`,
                    txHash: mockTxHash,
                    reference
                }
            };

        } catch (balanceError) {
            // Rollback transaction on failure
            transaction.status = 'failed';
            await transaction.save();
            throw balanceError;
        }

    } catch (error) {
        console.error('Error processing crypto withdrawal:', error.message);
        throw new Error(`Withdrawal failed: ${error.message}`);
    }
};

// Calculate network fee (simplified - use real fee estimation APIs in production)
const calculateNetworkFee = (currency, network = null) => {
    const baseFees = {
        BTC: 0.0001,
        ETH: 0.002,
        LTC: 0.001,
        BNB: 0.0005,
        ADA: 1.0,
        XRP: 0.00001,
        USDT: 0.002, // ETH network default
        USDC: 0.002  // ETH network default
    };

    // Adjust fees based on network
    const networkMultipliers = {
        'Ethereum': 1.0,
        'ERC20': 1.0,
        'BSC': 0.1,
        'BEP20': 0.1,
        'Tron': 0.05,
        'TRC20': 0.05,
        'Polygon': 0.01
    };

    const baseFee = baseFees[currency] || 0.001;
    const multiplier = networkMultipliers[network] || 1.0;

    return baseFee * multiplier;
};

// Get withdrawal history
const getWithdrawalHistory = async (userId, currency = null, limit = 20, page = 1) => {
    try {
        const skip = (page - 1) * limit;
        
        const query = {
            userId,
            type: 'withdrawal',
            method: 'crypto_transfer'
        };

        if (currency) {
            query.currency = currency;
        }

        const withdrawals = await transactionModel.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip);

        const total = await transactionModel.countDocuments(query);

        return {
            withdrawals,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };

    } catch (error) {
        console.error('Error getting withdrawal history:', error.message);
        throw new Error(`Failed to get withdrawal history: ${error.message}`);
    }
};

// Check withdrawal status by reference
const checkWithdrawalStatus = async (reference) => {
    try {
        const transaction = await transactionModel.findOne({ reference });
        
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        return {
            reference,
            status: transaction.status,
            amount: transaction.amount,
            currency: transaction.currency,
            walletAddress: transaction.cryptoDetails?.walletAddress,
            txHash: transaction.cryptoDetails?.txHash,
            networkFee: transaction.cryptoDetails?.gasFee,
            createdAt: transaction.createdAt,
            updatedAt: transaction.updatedAt
        };

    } catch (error) {
        console.error('Error checking withdrawal status:', error.message);
        throw new Error(`Failed to check withdrawal status: ${error.message}`);
    }
};

// Test crypto transfer operations
// const testCryptoTransferOperations = async () => {
//     try {
//         console.log('🔄 Testing Crypto Transfer Service...\n');

//         // Test user ID (use a real ObjectId in production)
//         const testUserId = '64f7b1234567890123456789';

//         // Test 1: Validate wallet addresses
//         console.log('1. Testing wallet address validation...');
//         const addresses = {
//             BTC: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
//             ETH: '0x742c4638A48F29709095B0D4e27ff9dfBe85BAF0',
//             USDT: '0x742c4638A48F29709095B0D4e27ff9dfBe85BAF0'
//         };

//         for (const [currency, address] of Object.entries(addresses)) {
//             const isValid = validateWalletAddress(currency, address);
//             console.log(`✅ ${currency} address validation: ${isValid ? 'VALID' : 'INVALID'}`);
//         }

//         // Test 2: Add external wallet
//         console.log('\n2. Adding external wallet...');
//         try {
//             const wallet = await addExternalWalletWithValidation(testUserId, {
//                 currency: 'BTC',
//                 address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
//                 label: 'My BTC Wallet',
//                 network: 'Bitcoin'
//             });
//             console.log('✅ External wallet added successfully');
//         } catch (walletError) {
//             console.log('ℹ️ External wallet test:', walletError.message);
//         }

//         // Test 3: Calculate network fees
//         console.log('\n3. Testing network fee calculation...');
//         const fees = {
//             BTC: calculateNetworkFee('BTC'),
//             ETH: calculateNetworkFee('ETH'),
//             'USDT-TRC20': calculateNetworkFee('USDT', 'TRC20'),
//             'USDT-ERC20': calculateNetworkFee('USDT', 'ERC20')
//         };

//         for (const [currency, fee] of Object.entries(fees)) {
//             console.log(`✅ ${currency} network fee: ${fee}`);
//         }

//         // Test 4: Get external wallets
//         console.log('\n4. Getting external wallets...');
//         try {
//             const externalWallets = await getExternalWallet(testUserId);
//             console.log(`✅ Found ${externalWallets.length} external wallets`);
//         } catch (error) {
//             console.log('ℹ️ External wallets test:', error.message);
//         }

//         // Test 5: Process test withdrawal (small amount)
//         console.log('\n5. Testing crypto withdrawal...');
//         try {
//             const withdrawal = await processCryptoWithdrawal(
//                 testUserId,
//                 0.0001,
//                 'BTC',
//                 '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
//             );
//             console.log('✅ Withdrawal processed successfully:');
//             console.log(`   Amount: ${withdrawal.amount} ${withdrawal.currency}`);
//             console.log(`   Address: ${withdrawal.walletAddress}`);
//             console.log(`   TX Hash: ${withdrawal.txHash}`);
//             console.log(`   Reference: ${withdrawal.reference}`);
//         } catch (withdrawalError) {
//             console.log('ℹ️ Withdrawal test skipped:', withdrawalError.message);
//         }

//         // Test 6: Get withdrawal history
//         console.log('\n6. Getting withdrawal history...');
//         const history = await getWithdrawalHistory(testUserId, null, 5);
//         console.log(`✅ Found ${history.withdrawals.length} withdrawals in history`);

//         console.log('\n✅ All crypto transfer tests completed successfully!');

//     } catch (error) {
//         console.error('❌ Crypto transfer test failed:', error.message);
//     }
// };

// testCryptoTransferOperations();

module.exports = {
    validateWalletAddress,
    addExternalWalletWithValidation,
    processCryptoWithdrawal,
    calculateNetworkFee,
    getWithdrawalHistory,
    checkWithdrawalStatus,
    // testCryptoTransferOperations,
    supportedNetworks
};



