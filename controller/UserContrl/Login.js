const userModel = require("../../model/userModel");
const bcrypt = require("bcryptjs");
const ErrorDisplay = require("../../utils/random.util");
const { createJWT } = require("../../middleware/jwtAuth");

//route to login user
const Login = async (req, res) => {
  try {
    const { Email, Password } = req.body;
    if (!Email || !Password)
      return res
        .status(400)
        .json({ Error: true, Message: "All input fields are required" });

    const user = await userModel.findOne({ Email });
    if (!user)
      return res.status(400).json({ Error: true, Message: "user not found" });

    // Check if user signed up with OAuth
      if (user.authProvider !== 'local' && !user.Password) {
          return res.status(400).json({ 
              Error: true, 
              Message: `This account was created using ${user.authProvider}. Please sign in with ${user.authProvider}.` 
          });
      }

    const validPwd = bcrypt.compareSync(Password, user.Password);
    if (!validPwd)
      return res
        .status(400)
        .json({ Error: true, Message: "Incorrect Password" });
    //store user in session
    req.session.userId = user.id;

    //jwt from auth 
    const token = await createJWT(user, 'User');

    res.status(200).json({
      Error: false,
      Message: "login successful",
      Auth: token,
      User: user,
    });
  } catch (error) {
    console.log("error loging in user", error);
    res.status(400).json({ Error:ErrorDisplay(error).message, Message: "fatal error" });
  }
};

module.exports = Login;
