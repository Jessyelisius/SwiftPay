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
<<<<<<< HEAD
    res.redirect("/dashboard"); // Redirect after successful login
    // res.redirect("/Home") ///implement with frontend
    // res.status(200).json({ Error: false, Message: "Welcome to dashboard" });
=======
    // res.redirect("/Home") ///implement with frontend
    res.status(200).json({ Error: false, Message: "Welcome to dashboard" });
>>>>>>> 73b8a1f7248462b0cea478f10c38419fcb0d3b1c
  }
);

//// Logout Route
router.get("/logout", (req, res) => {
  req.logout();
<<<<<<< HEAD
  req.session.destroy();
=======
>>>>>>> 73b8a1f7248462b0cea478f10c38419fcb0d3b1c
  res.redirect("/");
});

module.exports = router;
