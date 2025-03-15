const express = require("express");
require("dotenv").config();
const DBconnection = require("./config/dbconn");
const morgan = require("morgan");

const app = express();

const port = process.env.PORT;
DBconnection();

////////////middleware////////
app.use(morgan("dev"));
app.use(express.json());

app.listen(port, () => console.log(`swiftPay app listening on port ${port}!`));
