const walletModel = require("../../model/walletModel");
const { ErrorDisplay } = require("../../utils/random.util");


const userBalance = async(req, res) => {
    try {
        
        const user = req.user; // Assuming req.user contains the authenticated user's information
        if (!user) {
            return res.status(401).json({ Error: true, Message: "Unauthorized || user not found" });
        }
        if(!user?.isKYCVerified) {
            return res.status(403).json({Error: true, Message: "Forbidden || KYC not verified" });
        }

        //validate user ID
        const userId = user._id; // Assuming user._id is the user's ID
        if (!userId) {
            return res.status(400).json({ Error: true, Message: "Bad Request || User ID is required" });
        }

        if(!user?.EmailVerif) {
            return res.status(403).json({Error: true, Message: "Forbidden || Email not verified" });
        }

        if(!user?.isprofileVerified) {
            return res.status(403).json({Error: true, Message: "Forbidden || Profile not verified" });
        }

        // Fetch the user's wallets
        const wallets = await walletModel.find({ userId: userId }).select('balance currency'); // Adjust the fields as needed
        if (!wallets || wallets.length === 0) {
            return res.status(404).json({ Error: true, Message: "No wallets found for this user" });
        }
        //get both wallets
        const [ngnWallet, usdWallet] = await Promise.all([
            walletModel.findOne({ userId: userId, currency: 'NGN' }).lean(),
            walletModel.findOne({ userId: userId, currency: 'USD' }).lean()
        ]);

        return res.status(200).json({
            Access: true,
            Error: false,
            Message: "Wallet balances retrieved successfully",
            Data: {
                NGN: ngnWallet ? ngnWallet.balance : 0, // Default to 0 if wallet not found
                USD: usdWallet ? usdWallet.balance : "Not created"
            }
        });
    } catch (error) {
        console.error("Error fetching wallet balances:", error);
        return res.status(500).json({ 
            Error: true, 
            Message: "Internal Server Error",
            Data: {
                error: ErrorDisplay(error).message || "An unexpected error occurred"
            }
        });
    }
}

module.exports = {
    userBalance
};