const profileModel = require("../../model/profile.Model");
const userModel = require("../../model/userModel");
const ErrorDisplay = require("../../utils/random.util");

const Profile = async (req, res) => {
    try {
        const Input = req.body;

        // Validate required fields
        if (!Input.phone || !Input.dob || !Input.address || !Input.gender || !Input.stateOfOrigin || !Input.country || !Input.profilePhoto || !Input.transactionPin) {
            return res.status(400).json({ Error: true, Message: "All fields are required to update your profile" });
        }

        // Find user
        const user = await userModel.findById(req.user._id);
        if (!user) {
            return res.status(400).json({ Error: true, Message: "User not found" });
        }

        // if (profileModel.kycStatus !== 'approved') {
        //     return res.status(400).json({ Error: true, Message: "You must complete KYC verification before this action" });
        // }
        
        // Create Profile
        await profileModel.create({
            user: req.user._id,
            phone: Input.phone,
            dob: Input.dob,
            address: Input.address,
            gender: Input.gender,
            stateOfOrigin: Input.stateOfOrigin,
            country: Input.country,
            profilePhoto: Input.profilePhoto,
            transactionPin: Input.transactionPin // will be hashed in the model's pre('save')
        });

        // Update user's profileVerified field
        await userModel.updateOne(
            { _id: req.user._id },
            { profileVerified: true }
        );

        return res.status(201).json({ Error: false, Message: "Profile updated successfully" });

    } catch (error) {
        console.log('Error updating profile:', error);
        return res.status(500).json({ Error: true, Message: ErrorDisplay(error).msg || "Unable to update profile" });
    }
};

module.exports = {
    Profile
};
