import axios from "axios";
import logger from "../utils/loogger.js";
import { AppError } from "../utils/AppError.js";
import { assertWhatsAppTokenValid } from "../utils/verifyAccessToken.js";

/**
 * Send WhatsApp template message
 * @param {Object} options - Configuration object
 * @param {string} options.phone - Recipient phone number (E.164 format)
 * @param {string} options.templateName - Name of the template in Meta
 * @param {string} options.language - Language code (e.g., "en", "en_US")
 * @param {Array<string>} options.params - Template parameters for body variables
 * @param {Object} options.waNumber - WhatsApp number object with phoneNumberId and accessToken
 * @returns {Promise<Object>} API response
 */
export async function sendTemplate({
  phone,
  templateName,
  language,
  params = [],
  waNumber,
}) {
  assertWhatsAppTokenValid(waNumber);

  try {
    const url = `https://graph.facebook.com/v18.0/${waNumber.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components: [
          {
            type: "body",
            parameters: params.map((text) => ({
              type: "text",
              text: String(text),
            })),
          },
        ],
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${waNumber.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    logger.info("WhatsApp template sent successfully", {
      meta: {
        templateName,
        phone,
        messageId: response.data.messages?.[0]?.id,
      },
    });

    return response.data;
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    logger.error("Error sending WhatsApp template", {
      meta: {
        templateName,
        phone,
        error: errorDetails,
      },
    });
    throw error;
  }
}

/**
 * Send text message (not template)
 * @param {Object} options - Configuration object
 * @param {string} options.phone - Recipient phone number (E.164 format)
 * @param {string} options.text - Message text
 * @param {Object} options.waNumber - WhatsApp number object
 * @returns {Promise<Object>} API response
 */
export async function sendTextMessage({ phone, text, waNumber }) {
  assertWhatsAppTokenValid(waNumber);
  try {
    const url = `https://graph.facebook.com/v18.0/${waNumber.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${waNumber.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    logger.info("WhatsApp text message sent successfully", {
      meta: {
        phone,
        messageId: response.data.messages?.[0]?.id,
      },
    });

    return response.data;
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    logger.error("Error sending WhatsApp text message", {
      meta: { phone, error: errorDetails },
    });
    throw error;
  }
}
