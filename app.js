const express = require("express");
require("dotenv").config();
const DBconnection = require("./config/dbconn");
const morgan = require("morgan");
const session = require("express-session");
const passport = require("passport");

const app = express();

const port = process.env.PORT;
DBconnection();

////////////middleware////////
app.use(morgan("dev"));
app.use(express.json());
app.use(
  session({
    secret: process.env.session_secret,
    resave: false,
    saveUninitialized: true,
    // cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 },
  })
);

///google route implementation///////////////
app.use(passport.initialize());
app.use(passport.session());

/////////////user auth route////////////////
app.use("/auth", require("./routes/userRoute/user"));
app.use("/auth", require("./routes/GoogleAuth/googleAuthRoute"));

// /////////////user auth route////////////////
// app.use("/auth", require("./routes/userRoute/user"));
app.listen(port, () => console.log(`swiftPay app listening on port ${port}!`));
