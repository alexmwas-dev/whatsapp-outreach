import axios from "axios";
import logger from "../utils/loogger.js";
import { AppError } from "../utils/AppError.js";
import {
  assertWhatsAppTokenValid,
  getSystemWhatsAppToken,
} from "../utils/verifyAccessToken.js";
import { prisma } from "../lib/prisma.js";

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
  expectedParams,
  waNumber,
  organizationId,
}) {
  assertWhatsAppTokenValid(waNumber);

  if (expectedParams != null && params.length !== expectedParams) {
    throw new Error(
      `Template expects ${expectedParams} params, got ${params.length}`,
    );
  }
  const accessToken = getSystemWhatsAppToken();

  try {
    const url = `https://graph.facebook.com/v18.0/${waNumber.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(params.length > 0
          ? {
              components: [
                {
                  type: "body",
                  parameters: params.map((text) => ({
                    type: "text",
                    text: String(text),
                  })),
                },
              ],
            }
          : {}),
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

    const orgId = organizationId ?? waNumber?.organizationId;
    if (orgId) {
      await prisma.whatsAppTemplate.updateMany({
        where: {
          organizationId: orgId,
          name: templateName,
        },
        data: { usageCount: { increment: 1 } },
      });
    }

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
  const accessToken = getSystemWhatsAppToken();
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
        Authorization: `Bearer ${accessToken}`,
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
