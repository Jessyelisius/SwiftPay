const fs = require('fs');
const crypto = require('crypto');

const korapayPublicKey = process.env.korapay_public_key;
// fs.readFileSync('./korapay_public_key.pem', 'utf-8');

function encryptKorapayPayload(payload) {
    const bufferData = Buffer.from(JSON.stringify(payload));
    const encrypted = crypto.publicEncrypt(
        {
            key: korapayPublicKey,
            padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        bufferData
    );
    return encrypted.toString("base64");
}

module.exports = { encryptKorapayPayload };
