const express = require("express");
require("dotenv").config();
const DBconnection = require("./config/dbconn");
const morgan = require("morgan");
const session = require("express-session");
<<<<<<< HEAD
const passport = require("passport");
=======
>>>>>>> dbd814f694839ba97dc2d8b199d0234fef3d7cd2

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
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 },
  })
);

<<<<<<< HEAD
///google route implementation///////////////
app.use(passport.initialize());
app.use(passport.session());

/////////////user auth route////////////////
app.use("/auth", require("./routes/userRoute/user"));
app.use("/auth", require("./routes/GoogleAuth/googleAuthRoute"));

=======
/////////////user auth route////////////////
app.use("/auth", require("./routes/userRoute/user"));
>>>>>>> dbd814f694839ba97dc2d8b199d0234fef3d7cd2
app.listen(port, () => console.log(`swiftPay app listening on port ${port}!`));
