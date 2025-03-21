const mongoose = require("mongoose");

const DBconnection = async () => {
  try {
    const dbConne = await mongoose.connect(process.env.dbConnection);
    console.log("database connection establish");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

module.exports = DBconnection;
