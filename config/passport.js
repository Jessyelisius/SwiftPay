const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const userModel = require('../model/userModel');

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await userModel.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user exists
        let user = await userModel.findOne({ googleId: profile.id });

        if (user) {
            return done(null, user);
        }

        // Create new user
        user = await userModel.create({
            googleId: profile.id,
            Email: profile.emails[0].value,
            FirstName: profile.name.givenName,
            LastName: profile.name.familyName,
            profilePhoto: profile.photos[0]?.value,
            EmailVerif: true,
            EmailToken: null,
            // isprofileVerified: false,
            Phone: null, // Add this
            Password: null, // Add this
            authProvider: 'google',
            createdAt: new Date()
        });

        done(null, user);
    } catch (error) {
        done(error, null);
    }
}));

module.exports = passport;