const adminModel = require("../../model/admin/admin.Model");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ErrorDisplay = require("../../utils/random.util");

const Login = async(req, res) => {
    try {
        const {Email, Password} = req.body;

        if(!Email || !Password) return res.status(400).json({Error:true, Message:"All fields are required"})

        const user = await adminModel.findOne({Email})
        if(!user) return res.status(400).json({Error:true, Message:"user not found"});

        const validPwd = bcrypt.compareSync(Password, user.Password);
        if(!validPwd) return res.status(400).json({Error:true, Message:"Password is Incorrect"});

        // //store user in session
        // req.session.userId = user.id

        //jwt
        const token = jwt.sign({
            userId:user.id,
            Email:user.Email
        },process.env.jwt_secret_token,{expiresIn:"1D"});

        res.status(200).json({Error:false, Message:'Login successful', Result:token})
    } catch (error) {
        console.log("error logging in", error);
        res.status(400).json({Error:ErrorDisplay(error).msg});
    }
}

module.exports = Login;