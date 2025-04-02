function ErrorDisplay(error) {
  console.error(error); // Log for debugging, you can remove in production

  if (error.name === "MongoServerError" && error.code === 11000) {
    return {
      msg: "Oops! It seems like the details you provided already exist in our system. Please try again.",
    };
  }

  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map((err) => err.message);
    return {
      msg: messages.length
        ? messages[0]
        : "Invalid data. Please check your input.",
    };
  }

  if (error.message) {
    return { msg: error.message };
  }

  return { msg: "An unexpected error occurred. Please try again later." };
}


module.exports = ErrorDisplay;
