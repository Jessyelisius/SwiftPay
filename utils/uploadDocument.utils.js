// .env file additions (add these to your existing .env file)
/*
# Fincra API Configuration
FINCRA_API_KEY=your_fincra_api_key_here
FINCRA_BASE_URL=https://api.fincra.com
FINCRA_WEBHOOK_SECRET=your_webhook_secret_here

# AWS S3 Configuration for document storage (if using S3)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-swiftpay-documents-bucket
*/

// utils/documentUpload.util.js
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

// Allowed file types for KYC documents
const allowedFileTypes = /jpeg|jpg|png|pdf/;

// File filter function
const fileFilter = (req, file, cb) => {
    // Check file extension
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    // Check mime type
    const mimetype = allowedFileTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed!'));
    }
};

// Configure multer for S3 upload
const uploadToS3 = multer({
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
});

// Alternative: Local file upload (if not using S3)
const localStorage = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadPath = path.join(__dirname, '../uploads/usd-kyc');
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

// Document upload middleware
const uploadUsdKycDocuments = uploadToS3.fields([
    { name: 'utilityBill', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'meansOfId', maxCount: 2 } // Can be 1 or 2 files (front/back for driver license)
]);

// Alternative for local storage
const uploadUsdKycDocumentsLocal = localStorage.fields([
    { name: 'utilityBill', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'meansOfId', maxCount: 2 }
]);

// Utility function to generate secure document URLs
const generateDocumentUrl = (fileName) => {
    if (process.env.NODE_ENV === 'production') {
        // For S3
        return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    } else {
        // For local development
        return `${process.env.BASE_URL || 'http://localhost:3000'}/uploads/usd-kyc/${fileName}`;
    }
};

// Validate document types for Fincra
const validateFincraDocuments = (files) => {
    const errors = [];

    // Check required documents
    if (!files.utilityBill || files.utilityBill.length === 0) {
        errors.push('Utility bill is required');
    }

    if (!files.bankStatement || files.bankStatement.length === 0) {
        errors.push('Bank statement is required');
    }

    if (!files.meansOfId || files.meansOfId.length === 0) {
        errors.push('Means of ID is required');
    }

    // Validate file sizes and types
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

// Helper function to process uploaded documents for Fincra API
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
            // Single document (passport)
            documentUrls.meansOfId = files.meansOfId[0].location || generateDocumentUrl(files.meansOfId[0].filename);
        } else {
            // Multiple documents (driver license front/back)
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
    generateDocumentUrl
};