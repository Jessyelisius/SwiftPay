const { default: axios } = require("axios");
const kycModel = require("../../model/kyc.Model");
const userModel = require("../../model/userModel");
const { Sendmail } = require("../../utils/mailer.util");
const ErrorDisplay = require("../../utils/random.util");
const profileModel = require("../../model/profile.Model");

const submitKYC = async (req, res) => {
    try {
        const { idType, idNumber } = req.body;

        if (!idType || !idNumber) return res.status(400).json({ Error: true, Message: "All fields are required" });

        const existingKyc = await kycModel.findOne({ userid: req.user.id });
        if (existingKyc) return res.status(400).json({ Error: true, Message: "You've already submitted your KYC" });

        const user = await userModel.findById(req.user.id);
        if (!user) return res.status(404).json({ Error: true, Message: "User not found" });

        if (!user.isprofileVerified) {
            return res.status(400).json({ Error: true, Message: "Please complete your profile before doing KYC" });
        }

        let integrate;

        if (idType === 'nin') {
            if (isNaN(idNumber)) return res.status(400).json({ Access: true, Error: 'NIN must be numeric' });
            if (idNumber.length !== 11) return res.status(400).json({ Access: true, Error: 'NIN must be 11 digits' });

            integrate = (await axios({
                url: 'https://integrations.getravenbank.com/v1/nin/verify',
                method: 'post',
                headers: {
                    "Authorization": `Bearer ${process.env.RAVEN_API_KEY}`,
                    "Content-Type": 'application/json'
                },
                data: { nin: idNumber }
            })).data;
        } else {
            if (idNumber.length !== 19) return res.status(400).json({ Access: true, Error: 'Voter’s card must be 19 digits' });

            integrate = (await axios({
                url: 'https://integrations.getravenbank.com/v1/pvc/verify',
                method: 'post',
                headers: {
                    "Authorization": `Bearer ${process.env.RAVEN_API_KEY}`,
                    "Content-Type": 'application/json'
                },
                data: { voters_card: idNumber }
            })).data;
        }

        if (!integrate || !integrate.data) return res.status(400).json({ Error: true, Message: `Couldn't verify ${idType}` });

        const NinFirstname = integrate.data.firstname;
        const NinLastname = integrate.data.lastname;
        const fullName = `${user.FirstName} ${user.LastName}`.toLowerCase();

        if (
            !fullName.includes(NinFirstname.toLowerCase()) &&
            !fullName.includes(NinLastname.toLowerCase())
        ) {
            return res.status(400).json({ Access: true, Error: 'Your name does not match the one on the ID' });
        }

        await kycModel.create({
            userid: req.user.id,
            idType,
            idNumber
        });

        await userModel.updateOne({ _id: req.user.id }, {
            KycType: idType,
            KycDetails: integrate.data
        });

        await profileModel.updateOne({ user: req.user.id }, { profilePhoto: integrate.data.photo });

        res.status(200).json({ Access: true, Error: false, Data: integrate.data });

        await Sendmail(user.Email, "KYC Verified", "Congrats! Your KYC verification was successful.");

    } catch (error) {
        console.log(error?.response?.data || error);
        return res.status(500).json({ Error: true, Message: ErrorDisplay(error).msg });
    }
};

module.exports = submitKYC;
