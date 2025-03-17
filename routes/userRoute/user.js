const express = require("express");
const {
  Registration,
  verifyEmail,
} = require("../../controller/UserContrl/Register");
const Login = require("../../controller/UserContrl/Login");

const router = express.Router();

router.post("/register", Registration);
router.get("/verify-email", verifyEmail);
router.post("/login", Login);

module.exports = router;
