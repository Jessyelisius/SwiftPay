const jwt = require("jsonwebtoken");
const userModel = require("../../model/userModel");
const bcrypt = require("bcryptjs");

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

    const validPwd = bcrypt.compareSync(Password, user.Password);
    if (!validPwd)
      return res
        .status(400)
        .json({ Error: true, Message: "Incorrect Password" });
    //store user in session
    req.session.userId = user.id;

    //jwt
    const token = jwt.sign(
      {
        userId: user._id,
      },
      process.env.jwt_secret_token,
      { expiresIn: "1hr" }
    );

    res.status(200).json({
      Error: false,
      Message: "login successful",
      Result: token,
      User: user,
    });
  } catch (error) {
    console.log("error loging in user", error);
    res.status(400).json({ Error: true, Message: "fatal error" });
  }
};

module.exports = Login;
