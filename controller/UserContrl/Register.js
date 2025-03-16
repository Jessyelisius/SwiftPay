const userModel = require("../../model/userModel");
const bcrypt = require("bcryptjs");

const Registration = async (req, res) => {
  // Email regex pattern for basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Password regex: at least 4 chars, includes a letter & a number
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{4,}$/;

  try {
    const Input = req.body;
    if (!Input.FirstName)
      return res
        .status(400)
        .json({ Error: true, Message: "Firstname is required" });
    if (!Input.LastName)
      return res
        .status(400)
        .json({ Error: true, Message: "Lastname is required" });
    if (!Input.Email)
      return res
        .status(400)
        .json({ Error: true, Message: "Email is required" });
    if (Input.Password.length < 6)
      return res
        .status(400)
        .json({ Error: true, Message: "Password is short, min of 6 chars" });
    if (!passwordRegex.test(Input.Password))
      return res.status(400).json({
        Error: true,
        Message: "Password must contain at least one letter and one number",
      });
    if (!Input.Phone)
      return res
        .status(400)
        .json({ Error: true, Message: "Phone number is required" });

    const existingUser = await userModel.findOne({ Email: Input.Email });
    if (existingUser)
      return res
        .status(400)
        .json({ Error: true, Message: "User exist, pls login" });

    const hashpwd = bcrypt.hashSync(Input.Password, 10);
    const user = await userModel.create({
      FirstName: Input.FirstName,
      LastName: Input.LastName,
      Email: Input.Email,
      Password: hashpwd,
      Phone: Input.Phone,
      EmailVerif: false,
    });

    res
      .status(200)
      .json({ Error: false, Message: "User created", Result: user });
  } catch (error) {
    console.log("error creating user", error);
    res.status(400).json({ Error: true, Message: "fatal error" });
  }
};

module.exports = Registration;
