const express = require("express");
const Registration = require("../../controller/UserContrl/Register");
const Login = require("../../controller/UserContrl/Login");

const router = express.Router();

router.post("/register", Registration);
router.post("/login", Login);

module.exports = router;
