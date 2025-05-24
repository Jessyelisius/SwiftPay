const express = require("express");
const { handleKorapayWebhook, handleSuccessfulCharge, handleFailedCharge } = require("../../webhook");
const router = express.Router();
// const korapayWebhook = require("../controllers/korapayWebhookController");

router.post("/", express.json({ type: "*/*" }), handleKorapayWebhook, handleSuccessfulCharge, handleFailedCharge); // ensures raw body is parsed

module.exports = router;
