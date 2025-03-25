const transactionModel = require("../../model/transactionModel");


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

module.exports = {
    getUserTransaction
}