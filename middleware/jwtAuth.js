const express = require("express");
const jwt = require("jsonwebtoken");
const AuthModel = require("../model/AuthModel");
const ErrorDisplay = require("../utils/random.util");
const userModel = require("../model/userModel");

// const validationToken = async (req, res, next) => {
//   try {
//     //check session first
//     if (req.session && req.session.userId) {
//       req.userId = req.session.userId;
//       return next();
//     }

//     let token;
//     //check for token in auth headers
//     const AuthHeaders = req.headers.Authorization || req.headers.authorization;
//     if (AuthHeaders && AuthHeaders.startsWith("Bearer")) {
//       token = AuthHeaders.split(" ")[1];
//     }

//     if (!token) {
//       console.error("No session or token found"); //validate if token is available
//       return res
//         .status(400)
//         .json({ Error: true, Message: "No session or token found, login " });
//     }
//     jwt.verify(token, process.env.jwt_secret_token, (err, decoded) => {
//       if (err) {
//         console.error("validation failed");
//         res
//           .status(400)
//           .json({ Error: true, Message: "Validation failed, login" });
//       }
//       req.userId = decoded.userId;
//       next();
//     });
//   } catch (error) {
//     console.error("Error in ValidateAuth middleware:", error.message);
//     return res.json({
//       Error: true,
//       Message: "Error in validating auth, pls login",
//     });
//   }
// };

const createJWT = async(payload, Role) =>{
  try {

    // Remove any existing auth record for the user
    await AuthModel.deleteMany({UserID:payload._id});

     // Generate a transaction auth token
    let token = await jwt.sign(
      {...payload},
      process.env.jwt_secret_token,
      {expiresIn:'1D'}
    );

    //store the auth in token
    await AuthModel.create({
      UserID:payload._id,
      Auth:token,
      User:payload.FirstName,
      Role
    });

    return token;
  } catch (error) {
    console.log("error creating authorization",error.message)
    res.status(400).json({Message:"cannot create auth", Error:ErrorDisplay(error).message});
  } 
}

const verifyUserJwt = async(req,res,next) => {
  try {
     //check session first
    if (req.session && req.session.userId) {
      req.userId = req.session.userId;
      return next();
    }

    let token;

    const AuthHeaders = req.headers.Authorization || req.headers.authorization;
    if(AuthHeaders && AuthHeaders.startsWith('Bearer')){
      token = AuthHeaders.split(" ")[1]
    }
    
    if(!token) return res.status(400).json({Error:true, Message:"No session or token found,"})

    jwt.verify(token,process.env.jwt_secret_token, async(err, decode) => {
      if(err){
        res.status().json({Error:true, Message:"Invalid or expired token"});
      }
      let getAuth = await AuthModel.findOne({Auth:token, UserID:decode._doc._id, Role:"User"});

      if(getAuth) {
       const user = await userModel.findOne({_id:decode._doc._id});
      }

      req.user = user
      return next();
    })

  } catch (error) {
    res.status(400).json({Error:ErrorDisplay(error).message, Message:"error authenticating user"})
  }
}

module.exports = {
  createJWT,
  verifyUserJwt
};
