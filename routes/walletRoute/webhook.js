

// router.post("/", express.json({ type: "*/*" }), handleKorapayWebhook, handleSuccessfulCharge, handleFailedCharge); // ensures raw body is parsed

const express = require("express");
const router = express.Router();
const { handleKorapayWebhook } = require("../../webhook");

router.post(
  "/",
  // express.raw({ type: "application/json" }), // Important: Raw body for HMAC signature verification
  handleKorapayWebhook
);

module.exports = router;

