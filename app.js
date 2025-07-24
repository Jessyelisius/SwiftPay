const express = require("express");
require("dotenv").config();
const DBconnection = require("./config/dbconn");
const morgan = require("morgan");
const session = require("express-session");
const passport = require("passport");


const app = express();

const port = process.env.PORT;
DBconnection();

// Webhook Configuration (Run once on server start)
const configureWebhooks = async () => {
  try {
    const response = await axios.put(
      'https://api.korapay.com/merchant/api/v1/webhooks',
      {
        url: 'https://swiftpay-8evb.onrender.com/korapay-webhook',
        events: ['transfer.success', 'transfer.failed', 'charge.success', 'charge.failed'],
        enabled: true
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.KORAPAY_SECRET_KEY}`
        }
      }
    );
    console.log('✅ Webhooks configured:', response.data);
  } catch (error) {
    console.error('❌ Webhook setup failed:', {
      status: error.response?.status,
      data: error.response?.data || error.message
    });
    
    // Retry after 30 seconds if failed
    setTimeout(configureWebhooks, 30000);
  }
};

////////////middleware////////
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({extended:true}))
app.use(
  session({
    secret: process.env.session_secret,
    resave: false,
    saveUninitialized: true,
    // cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 },
  })
);
// kkkkkkk

/////////////////////////webhook route///////////////////////////////
// app.use("/korapay-webhook", express.raw({ type: 'application/json' }), require("./routes/walletRoute/webhook"));
app.use("/korapay-webhook", express.json(), require("./routes/walletRoute/webhook"));


///google route implementation///////////////
app.use(passport.initialize());
app.use(passport.session());

/////////////user auth route////////////////
app.use("/auth", require("./routes/userRoute/user"));
app.use("/auth", require("./routes/GoogleAuth/googleAuthRoute"));

/////////////////admin routes///////////////////
app.use("/admin", require("./routes/AdminRoute/admin"));

// /////////////wallet auth route///////////////
app.use("/wallet", require("./routes/walletRoute/wallet"));
app.use("/transaction", require("./routes/walletRoute/Transaction"));

app.listen(port, async() => {
  console.log(`swiftPay app listening on port ${port}!`);
  
  
  // Configure webhooks after server starts
  await configureWebhooks();
  
  // Verify webhook configuration
  try {
    const response = await axios.get(
      'https://api.korapay.com/merchant/api/v1/webhooks',
      {
        headers: {
          Authorization: `Bearer ${process.env.KORAPAY_SECRET_KEY}`
        }
      }
    );
    console.log('ℹ️ Current webhook config:', response.data);
  } catch (error) {
    console.error('Failed to verify webhooks:', error.message);
  }
});

