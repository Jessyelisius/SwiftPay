const express = require('express');
const router = express.Router();
const passport = require('../../config/passport');
const jwt = require('jsonwebtoken');

// Initiate Google OAuth
router.get('/google', 
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })
);

// Google OAuth callback
router.get('/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
        try {
            // Generate JWT token
            const token = jwt.sign(
                { id: req.user._id, email: req.user.Email },
                process.env.jwt_secret_token,
                { expiresIn: '7d' }
            );

            // Redirect to frontend with token
            res.redirect(`${process.env.frontendURL}/auth/success?token=${token}`);
        } catch (error) {
            console.error('Google auth error:', error);
            res.redirect('/login?error=auth_failed');
        }
    }
);

module.exports = router;