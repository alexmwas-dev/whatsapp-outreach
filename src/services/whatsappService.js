// WhatsApp service placeholdeimport axios from "axios";
import axios from "axios";
import { WHATSAPP_API_URL } from "../config/whatsapp.js";

export async function sendIntroTemplate(
  phone,
  contactName,
  repName,
  agencyName,
) {
  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: "intro_marketing_agency", // the template name in Meta
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: contactName }, // {{1}}
                { type: "text", text: repName }, // {{2}}
                { type: "text", text: agencyName }, // {{3}}
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  } catch (error) {
    console.error(
      "Error sending WhatsApp template:",
      error.response?.data || error.message,
    );
    throw error;
  }
}

export async function sendHelloWorldTemplate(phone) {
  // Log .env variables if they exist
  console.log("WHATSAPP_API_URL:", WHATSAPP_API_URL || "Not set");
  console.log(
    "WHATSAPP_TOKEN:",
    process.env.WHATSAPP_TOKEN ? "[SET]" : "Not set",
  );

  if (!WHATSAPP_API_URL || !process.env.WHATSAPP_TOKEN) {
    console.warn("⚠️ Missing required WhatsApp environment variables!");
    return;
  }

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: "hello_world",
          language: { code: "en_US" },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("WhatsApp API response:", response.data);
    return response.data;
  } catch (err) {
    console.error(
      "Error sending WhatsApp template:",
      err.response?.data || err.message,
    );
    throw err;
  }
}
