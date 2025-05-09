// deposite function/////////////////
const Deposit = async(req, res) => {
    const {amount} = req.body;

    const userId = req.user.id;

    if(amount <= 0) return res.status(400).json({Error:true, Message:"invalid Amount"});
    const session = await mongoose.startSession();
        session.startTransaction();

    try {

        let Wallet = await walletModel.findOne({userId}).session(session);
        if(!Wallet) Wallet = await walletModel.create([{userId, balance:0}],{session});

        Wallet.balance += amount;
        await Wallet.save({session});

        const Transaction = await transactionModel.create([{userId,amount,type:'deposit',status:'successful'}],{session});
        await session.commitTransaction();
        session.endSession();
        res.status(200).json({Error:false, Message:"Deposit successful", Transaction})

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ Message: 'Deposit failed', Error: error.message });
    }
}