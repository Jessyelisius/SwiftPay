const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const fs = require('fs');
const path = require('path');

// Configure AWS only if credentials exist
let s3 = null;
let isS3Configured = false;

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET) {
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
    });
    s3 = new AWS.S3();
    isS3Configured = true;
}

// Allowed file types for KYC documents
const allowedFileTypes = /jpeg|jpg|png|pdf/;

// File filter function
const fileFilter = (req, file, cb) => {
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedFileTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed!'));
    }
};

// Configure multer for S3 upload (only if S3 is configured)
const uploadToS3 = isS3Configured ? multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.AWS_S3_BUCKET,
        key: function (req, file, cb) {
            const userId = req.user._id;
            const timestamp = Date.now();
            const fileName = `usd-kyc/${userId}/${timestamp}-${file.originalname}`;
            cb(null, fileName);
        },
        contentType: multerS3.AUTO_CONTENT_TYPE
    }),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: fileFilter
}) : null;

// Local file upload configuration
const localStorage = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadPath = path.join(__dirname, '../uploads/usd-kyc');
            // Create directory if it doesn't exist
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }
            cb(null, uploadPath);
        },
        filename: function (req, file, cb) {
            const userId = req.user._id;
            const timestamp = Date.now();
            const fileName = `${userId}-${timestamp}-${file.originalname}`;
            cb(null, fileName);
        }
    }),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: fileFilter
});

// Smart upload middleware - uses S3 if configured, otherwise local
const uploadUsdKycDocuments = isS3Configured ? uploadToS3.fields([
    { name: 'utilityBill', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'meansOfId', maxCount: 2 }
]) : localStorage.fields([
    { name: 'utilityBill', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'meansOfId', maxCount: 2 }
]);

// Force local storage (for development)
const uploadUsdKycDocumentsLocal = localStorage.fields([
    { name: 'utilityBill', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'meansOfId', maxCount: 2 }
]);

// Generate document URLs
const generateDocumentUrl = (fileName) => {
    if (isS3Configured && process.env.NODE_ENV === 'production') {
        return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fileName}`;
    } else {
        return `${process.env.BASE_URL || 'http://localhost:3000'}/uploads/usd-kyc/${path.basename(fileName)}`;
    }
};

// Validate document types for Fincra
const validateFincraDocuments = (files) => {
    const errors = [];

    if (!files.utilityBill || files.utilityBill.length === 0) {
        errors.push('Utility bill is required');
    }

    if (!files.bankStatement || files.bankStatement.length === 0) {
        errors.push('Bank statement is required');
    }

    if (!files.meansOfId || files.meansOfId.length === 0) {
        errors.push('Means of ID is required');
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

    Object.keys(files).forEach(fieldName => {
        files[fieldName].forEach(file => {
            if (file.size > maxSize) {
                errors.push(`${fieldName} file size exceeds 10MB limit`);
            }
            if (!allowedTypes.includes(file.mimetype)) {
                errors.push(`${fieldName} must be JPEG, PNG, or PDF format`);
            }
        });
    });

    return errors;
};

// Process uploaded documents for Fincra API
const processDocumentsForFincra = (files) => {
    const documentUrls = {};

    if (files.utilityBill && files.utilityBill[0]) {
        documentUrls.utilityBill = files.utilityBill[0].location || generateDocumentUrl(files.utilityBill[0].filename);
    }

    if (files.bankStatement && files.bankStatement[0]) {
        documentUrls.bankStatement = files.bankStatement[0].location || generateDocumentUrl(files.bankStatement[0].filename);
    }

    if (files.meansOfId) {
        if (files.meansOfId.length === 1) {
            documentUrls.meansOfId = files.meansOfId[0].location || generateDocumentUrl(files.meansOfId[0].filename);
        } else {
            documentUrls.meansOfId = files.meansOfId.map(file => 
                file.location || generateDocumentUrl(file.filename)
            );
        }
    }

    return documentUrls;
};

module.exports = {
    uploadUsdKycDocuments,
    uploadUsdKycDocumentsLocal,
    validateFincraDocuments,
    processDocumentsForFincra,
    generateDocumentUrl,
    isS3Configured: () => isS3Configured
};