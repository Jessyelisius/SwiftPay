const mongoose = require('mongoose');
const bcrypt = require('bcryptjs')

const Schema =  mongoose.Schema;

const ProfileSchema = new Schema({
    user:{
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true,
    },
    phone:{
        type:String,
        required:true
    },
    dob:{
        type:Date,
        required:true
    },
    address:{
        type:String,
        required:true
    },
    gender:{ 
        type: String, 
        enum: ['male', 'female',]
     },
    stateOfOrigin:{
        type: String,
        required:true
    },
    // nin:{
    //     type: String 
    // },// Optional direct field (some apps do this);
    country:{
        type:String,
        required:true
    },
    profilePhoto:{
        type:String,
        required:true
    },
    transactionPin:{
        type:String,
        required:true
    },
    kycStatus:{
        type:String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    }
}, {timestamps:true});

//hash security pin before storing
ProfileSchema.pre("save", async function (next) {
    if(!this.isModified("transactionPin")) 
        return next();
    //hash pin
    const hashPin = await bcrypt.hash(this.transactionPin, 10);
    this.transactionPin = hashPin;
    next();
});

module.exports = mongoose.model('userProfile', ProfileSchema);