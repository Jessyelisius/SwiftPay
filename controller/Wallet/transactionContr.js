const { default: mongoose } = require("mongoose");
const transactionModel = require("../../model/transactionModel");
const walletModel = require("../../model/walletModel");


const getUserTransaction = async(req, res)=>{
    const userId = req.userId;

    try {
        const Transaction = await transactionModel.find({userId}).sort({createdAt:-1});
        if(!Transaction) return res.status(400).json({Error:true, Message:"no transactions found, create one"});
        res.status(200).json({Error:false, Message:"Transactions below", Result:Transaction});
    } catch (error) {
        console.log("error retrieving transac", error.message);
        res.status(500).json({ message: 'Error retrieving transactions', error: error.message });
    }
}

const Transfer = async(req, res) => {
    // const userId = req.userId;
    const {recipientId, amount} = req.body;
    const senderId = req.userId

    if(amount <= 0) return res.status(400).json({Acess:true, Error:"Invalid Amount"})
    const session = mongoose.startSession();
    session.startTransaction();

    try {
        const senderWallet = await walletModel.findOne({userId:senderId}).session(session);
        const recipientWallet = await walletModel.findOne({userId:recipientId}).session(session)

        
    } catch (error) {
        
    }
}

module.exports = {
    getUserTransaction
}