const express = require("express");
const passport = require("passport");
const router = express.Router();

//google authentication route
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

//google OAuth callback route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    // res.redirect("/Home") ///implement with frontend
    res.status(200).json({ Error: false, Message: "Welcome to dashboard" });
  }
);

//// Logout Route
router.get("/logout", (req, res) => {
  req.logout();
  res.redirect("/");
});

module.exports = router;
