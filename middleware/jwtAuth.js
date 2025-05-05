const express = require("express");
const jwt = require("jsonwebtoken");
const AuthModel = require("../model/AuthModel");
const ErrorDisplay = require("../utils/random.util");
const userModel = require("../model/userModel");
const adminModel = require("../model/admin/admin.Model");

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
      {_id:payload._id, Role:Role},
      process.env.jwt_secret_token,
      {expiresIn:'1D'}
    );

    //store the auth in token
    await AuthModel.create({
      UserID:payload._id,
      Auth:token,
      User:payload.FirstName || payload.Email,
      Role
    });

    return token;
  } catch (error) {
    console.log("error creating authorization",error.message)
    return {Message:"cannot create auth", Error:ErrorDisplay(error).message};
  } 
}

// ✅ Validate User's JWT Token
const verifyUserJwt = async(req,res,next) => {
  try {
     //check session first
    if (req.session && req.session.userId) {
      req.userId = req.session.userId;
      return next();
    }

    let token;

    const AuthHeaders = req.headers.Authorization || req.headers.authorization;
    if(AuthHeaders && AuthHeaders.startsWith("Bearer")){
      token = AuthHeaders.split(" ")[1]
    }
    
    if(!token) return res.status(400).json({Error:true, Message:"No session or token found,"})

    jwt.verify(token,process.env.jwt_secret_token, async(err, decoded) => {
      if(err || !decoded){
        return res.status(400).json({Error:true, Message:"Invalid or expired token"});
      }
      let getAuth = await AuthModel.findOne({
        Auth:token, 
        UserID:decoded?._id, 
        Role:"User"
      });

      if (!getAuth) {
        return res.status(403).json({
          Error: true,
          Message: "Unauthorized access",
        });
      }

      const user = await userModel.findById(decoded._id);
      if (!user) {
        return res.status(404).json({
          Error: true,
          Message: "User not found",
        });
      }
      // if(getAuth) {
      //  const user = await userModel.findOne({_id:decode._doc._id});
      // }

      req.user = user
      return next();
    });

  } catch (error) {
    return res.status(400).json({Error:ErrorDisplay(error).message, Message:"error authenticating user"})
  }
}

// ✅ Validate Admin's JWT Token
const verifyAdminJwt = async (req, res, next) => {
  try {

     //check session first
     if (req.session && req.session.userId) {
      req.userId = req.session.userId;
      return next();
    }

    let token;
    const AuthHeaders = req.headers.Authorization || req.headers.authorization;
    if (AuthHeaders && AuthHeaders.startsWith("Bearer")) {
      token = AuthHeaders.split(" ")[1];
    }

    if (!token) {
      return res.status(400).json({
        Error: true,
        Message: "No session or token found",
      });
    }

    jwt.verify(token, process.env.jwt_secret_token, async (err, decoded) => {
      if (err) {
        return res.status(400).json({
          Error: true,
          Message: "Invalid or expired token",
        });
      }

      let getAuth = await AuthModel.findOne({
        Auth: token,
        UserID: decoded._id,
        Role: "Admin",
      });

      if (!getAuth) {
        return res.status(403).json({
          Error: true,
          Message: "Unauthorized access",
        });
      }

      const admin = await adminModel.findById(decoded._id);
      if (!admin) {
        return res.status(404).json({
          Error: true,
          Message: "Admin not found",
        });
      }

      req.admin = admin;
      return next();
    });
  } catch (error) {
    return res.status(400).json({
      Error: true,
      Message: "Error authenticating admin",
    });
  }
};

module.exports = {
  createJWT,
  verifyUserJwt,
  verifyAdminJwt
};
