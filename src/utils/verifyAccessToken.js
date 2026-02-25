import { AppError } from "./AppError.js";

function getSystemWhatsAppToken() {
  const token = process.env.SYSTEM_USER_TOKEN || process.env.WHATSAPP_TOKEN;
  if (!token) {
    throw new AppError(
      "WhatsApp system token is missing. Set SYSTEM_USER_TOKEN or WHATSAPP_TOKEN in .env",
      500,
    );
  }
  return token;
}

function assertWhatsAppTokenValid(waNumber) {
  if (!waNumber) {
    throw new AppError(
      "WhatsApp number not configured for this organization",
      400,
    );
  }

  if (!waNumber.phoneNumberId) {
    throw new AppError("Invalid WhatsApp number configuration", 400);
  }
  // Validate env token presence for sending calls.
  getSystemWhatsAppToken();
}
export { assertWhatsAppTokenValid, getSystemWhatsAppToken };
