const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const AuthSchema = new Schema({
    UserID:{
        type:String,
        required:[true, "user Id is required"],
        unique:true,
    },
    Auth:{
        type:String,
        required:[true, "Auth is required"]
    },
    User:{
        type:String,
        required:[true, "Username Auth is required"],
    },
    Role:{
        type:String,
        required:[true, "Role is not defined"],
        enum:['User','Admin']
    },
    expiresAt:{
        type:Date,
        default:Date.now,
        expires:60 * 60 * 24,
    },
},{timestamps:true});

module.exports = mongoose.model("Auth", AuthSchema);