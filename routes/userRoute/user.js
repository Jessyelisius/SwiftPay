const express = require("express");
const Registration = require("../../controller/UserContrl/Register");

const router = express.Router();

router.post("/", Registration);

module.exports = router;
