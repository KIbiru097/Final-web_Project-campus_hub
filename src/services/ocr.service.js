const Tesseract = require('tesseract.js');
const axios = require('axios');
const sharp = require('sharp');

class OCRService {
  async verifyStudentId(imageUrl) {
    try {
      // Download image
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(response.data);
      
      // Preprocess image for better OCR
      const processedImage = await sharp(imageBuffer)
        .grayscale()
        .normalize()
        .sharpen()
        .toBuffer();
      
      // Extract text using Tesseract
      const { data: { text } } = await Tesseract.recognize(
        processedImage,
        'eng',
        {
          logger: m => {
            if (process.env.NODE_ENV === 'development') {
              console.log('OCR Progress:', m);
            }
          }
        }
      );
      
      // Parse student information from text
      const studentInfo = this.parseStudentInfo(text);
      
      // Validate against university database (placeholder)
      const isValid = await this.validateStudentInfo(studentInfo);
      
      return {
        isValid,
        extractedText: text,
        studentInfo,
        verified: isValid,
        error: isValid ? null : 'Student ID could not be verified',
      };
    } catch (error) {
      console.error('OCR Error:', error);
      return {
        isValid: false,
        extractedText: null,
        studentInfo: null,
        verified: false,
        error: error.message,
      };
    }
  }
  
  parseStudentInfo(text) {
    // University-specific patterns
    const patterns = {
      studentId: /(?:ID|STU|STD|SID)[:\s-]*(\d{6,12})/i,
      name: /(?:Name|Student Name)[:\s-]*([A-Za-z\s,.-]+)/i,
      department: /(?:Dept|Department|Program)[:\s-]*([A-Za-z\s&]+)/i,
      university: /(?:University|College)[:\s-]*([A-Za-z\s]+)/i,
      year: /(?:Year|Level)[:\s-]*(\d+)/i,
    };
    
    return {
      studentId: text.match(patterns.studentId)?.[1] || null,
      name: text.match(patterns.name)?.[1]?.trim() || null,
      department: text.match(patterns.department)?.[1]?.trim() || null,
      university: text.match(patterns.university)?.[1]?.trim() || null,
      year: text.match(patterns.year)?.[1] || null,
    };
  }
  
  async validateStudentInfo(studentInfo) {
    // In production, integrate with university API or database
    // This is a placeholder implementation
    
    if (!studentInfo.studentId) {
      return false;
    }
    
    // Check format (customize based on your university's format)
    if (!/^\d{6,12}$/.test(studentInfo.studentId)) {
      return false;
    }
    
    // Example: Call university API
    // const response = await axios.post('https://university-api.edu/verify-student', {
    //   studentId: studentInfo.studentId,
    //   name: studentInfo.name
    // });
    // return response.data.verified;
    
    // For now, accept if we have a valid student ID format
    return true;
  }
}

module.exports.ocrService = new OCRService();