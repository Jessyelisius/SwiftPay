const express = require("express");
const jwt = require("jsonwebtoken");

const validationToken = async (req, res, next) => {
  try {
    //check session first
    if (req.session && req.session.userId) {
      req.userId = req.session.userId;
      return next();
    }

    let token;
    //check for token in auth headers
    const AuthHeaders = req.headers.Authorization || req.headers.authorization;
    if (AuthHeaders && AuthHeaders.startsWith("Bearer")) {
      token = AuthHeaders.split(" ")[1];
    }

    if (!token) {
      console.error("No session or token found"); //validate if token is available
      return res
        .status(400)
        .json({ Error: true, Message: "No session or token found, login " });
    }
    jwt.verify(token, process.env.jwt_secret_token, (err, decoded) => {
      if (err) {
        console.error("validation failed");
        res
          .status(400)
          .json({ Error: true, Message: "Validation failed, login" });
      }
      req.userId = decoded.userId;
      next();
    });
  } catch (error) {
    console.error("Error in ValidateAuth middleware:", error.message);
    return res.json({
      Error: true,
      Message: "Error in validating auth, pls login",
    });
  }
};
