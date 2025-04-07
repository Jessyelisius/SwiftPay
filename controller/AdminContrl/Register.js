const adminModel = require("../../model/admin/admin.Model");


const Register = async(req, res) =>{
        // Email regex pattern for basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Password regex: at least 4 chars, includes a letter & a number
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{4,}$/;

    try {
        const Input = req.body

        if(!Input.FirstName) return res.status(400).json({ Error:true, Message:"firstname is required"});
        if(!Input.LastName) return res.status(400).json({Error:true, Message:"Lastname is required" });
        if(!Input.Email || emailRegex.test(Input.Email)) return res.status(400).json({Error:true, Message:"Invalid email format"});
        if(Input.Password?.length<6) return res.status(400).json({Error:true, Message:"Password is short min of 6 chars"});
        if(passwordRegex.test(Input.Password)) return res.status(400).json({Error:true, Message:"Password mush contain special chars"});

        const existingUser = await adminModel.findOne()
    } catch (error) {
        
    }
}