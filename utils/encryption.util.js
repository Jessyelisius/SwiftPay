// const fs = require('fs');
// const crypto = require('crypto');

// const korapayPublicKey = process.env.korapay_public_key;
// // fs.readFileSync('./korapay_public_key.pem', 'utf-8');

// function encryptKorapayPayload(payload) {
//     const bufferData = Buffer.from(JSON.stringify(payload));
//     const encrypted = crypto.publicEncrypt(
//         {
//             key: korapayPublicKey,
//             padding: crypto.constants.RSA_PKCS1_PADDING,
//         },
//         bufferData
//     );
//     return encrypted.toString("base64");
// }

// module.exports = { encryptKorapayPayload };

const fs = require('fs');
const crypto = require('crypto');

function getKorapayPublicKey() {
    if (process.env.korapay_public_key) {
        // If it's base64 encoded, decode it
        try {
            return Buffer.from(process.env.korapay_public_key, 'base64').toString('utf-8');
        } catch (e) {
            // If not base64, use as is
            return process.env.korapay_public_key;
        }
    }
    
    // Fallback to file
    return fs.readFileSync('./utils/korapay_public_key.pem', 'utf-8');
}

function encryptKorapayPayload(payload) {
    const korapayPublicKey = getKorapayPublicKey();
    
    // Validate key format
    if (!korapayPublicKey.includes('-----BEGIN') || !korapayPublicKey.includes('-----END')) {
        throw new Error('Invalid PEM key format');
    }
    
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