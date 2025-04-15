const mongoose = require('mongoose');
const bcrypt = require('bcryptjs')

const Schema =  mongoose.Schema;

const ProfileSchema = new Schema({
    userId:{
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
    country:{
        type:String,
        required:true
    },
    profilePhoto:{
        type:String,
        required:true
    },
    securityPin:{
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
    if(!this.isModified("securityPin")) 
        return next();

    //hash pin
    const hashPin = await bcrypt.hash(this.securityPin, 10);
    this.securityPin = hashPin;
    next();
});

module.exports = mongoose.model('userProfile', ProfileSchema);