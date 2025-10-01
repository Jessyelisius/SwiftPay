const passport = require("passport");
const userModel = require("../../model/userModel");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
require('dotenv').config()


passport.use(new GoogleStrategy({
    clientID: process.env.GoogleClientID,
    clientSecret: process.env.GoogleClientSecret,
    callbackURL: process.env.authorizedRedirectURI 
  },
  async (accessToken, refreshToken, profile, done) => {
    // Check if user already exists in your database
    const user = await userModel.findOne({ email: profile.emails[0].value });

    if (user) {
      return done(null, user); // User exists, log them in
    } else {
      // Create a new user
      const newUser = new User({
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        email: profile.emails[0].value,
        emailVerif: true, // Google-verified emails are trusted
        password: null, // No password for OAuth users
        phone: null,
        emailToken: null
      });

      await newUser.save();
      return done(null, newUser);
    }
  }
));

// Serialize and deserialize user
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  userModel.findById(id, (err, user) => done(err, user));
});


// passport.use(
//   new GoogleStrategy(
//     {
//       clientID: process.env.GoogleClientID,
//       clientSecret: process.env.GoogleClientSecret,
//       callbackURL: process.env.authorizedRedirectURI,
//     },
//     async (accessToken, refreshToken, profile, done) => {
//       try {
//         const email =
//           profile.emails && profile.emails.length > 0
//             ? profile.emails[0].value
//             : null;

//         let user = await userModel.findOne({ googleId: profile.id });

//         if (!user) {
//           user = await userModel.create({
//             googleId: profile.id,
//             FirstName: profile.name.givenName,
//             LastName: profile.name.familyName,
//             Email: email,
//             Phone: null, // Handle this in user profile update later
//             EmailVerif: true, // Automatically verified
//           });
//         }

//         return done(null, user);
//       } catch (error) {
//         return done(error, null);
//       }
//     }
//   )
// );

// passport.serializeUser((user, done) => done(null, user._id));

// passport.deserializeUser(async (id, done) => {
//   try {
//     const user = await userModel.findById(id);
//     done(null, user);
//   } catch (error) {
//     done(error, null);
//   }
// });

module.exports = passport;
