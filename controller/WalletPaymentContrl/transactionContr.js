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
        res.status(500).json({Error: error.message,  Message: 'Error retrieving transactions'});
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

        if(!senderWallet || senderWallet.balance<amount){
            return res.status(400).json({Error:true, Message:"Insufficient fund"});
        }
        if(!recipientWallet){
            return res.status(400).json({Error:true, Message:"Recipient account not found"})
        }

        //credit the recipient and debit the sender
        senderWallet.balance-=amount,
        recipientWallet.balance+=amount

        const Transaction = await transactionModel.create([{
            userId:senderId, 
            amount,
            type:"transfer",
            status:"successful"
        }], {session});

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({Error:false, Message:"Transfer successful", Transaction})
    } catch (error) {
        await session.abortTransaction();
        await session.endSession();
        console.log("transfer failed",error.message);
        res.status(500).json({Error:true,Message:"Transfer Failed"});
    }
}

module.exports = {
    getUserTransaction,
    Transfer
}