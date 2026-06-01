const nodemailer = require('nodemailer');
require('dotenv').config();

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  
  async sendWelcomeEmail(email, name) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #4F46E5;">Welcome to CampusHub! 🎓</h1>
        <p>Dear ${name},</p>
        <p>Thank you for joining CampusHub! Your account has been successfully created.</p>
        <p>You can now:</p>
        <ul>
          <li>📱 Browse products on the marketplace</li>
          <li>🍕 Order food from campus cafes</li>
          <li>💼 Offer or book services</li>
          <li>💬 Chat with other students</li>
        </ul>
        <p>Get started by completing your profile and exploring the platform!</p>
        <a href="${process.env.FRONTEND_URL}/dashboard" 
           style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin-top: 16px;">
          Go to Dashboard
        </a>
        <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px;">If you didn't create this account, please ignore this email.</p>
      </div>
    `;
    
    await this.sendEmail(email, 'Welcome to CampusHub!', html);
  }
  
  async sendPasswordResetEmail(email, name, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #4F46E5;">Reset Your Password</h1>
        <p>Dear ${name},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <a href="${resetUrl}" 
           style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 16px 0;">
          Reset Password
        </a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px;">For security, never share this link with anyone.</p>
      </div>
    `;
    
    await this.sendEmail(email, 'Reset Your CampusHub Password', html);
  }
  
  async sendOrderConfirmation(email, name, orderId, items) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #4F46E5;">Order Confirmed! 🎉</h1>
        <p>Dear ${name},</p>
        <p>Your order #${orderId} has been confirmed.</p>
        <h3>Order Summary:</h3>
        <ul>
          ${items.map(item => `<li>${item.name} x ${item.quantity} - $${item.price}</li>`).join('')}
        </ul>
        <a href="${process.env.FRONTEND_URL}/orders/${orderId}" 
           style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin-top: 16px;">
          Track Order
        </a>
      </div>
    `;
    
    await this.sendEmail(email, `Order Confirmation #${orderId}`, html);
  }
  
  async sendEmail(to, subject, html) {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
      });
      console.log(`Email sent to ${to}`);
    } catch (error) {
      console.error('Email sending failed:', error);
      // Don't throw - email failures shouldn't break the app
    }
  }
}

module.exports.emailService = new EmailService();