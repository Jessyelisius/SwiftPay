const express = require("express");
require("dotenv").config();
const DBconnection = require("./config/dbconn");
const morgan = require("morgan");
const session = require("express-session");

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

/////////////user auth route////////////////
app.use("/auth", require("./routes/userRoute/user"));
app.listen(port, () => console.log(`swiftPay app listening on port ${port}!`));
