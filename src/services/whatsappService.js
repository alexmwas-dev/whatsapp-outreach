// WhatsApp service placeholdeimport axios from "axios";
import { WHATSAPP_API_URL } from "../config/whatsapp.js";

export async function sendIntroTemplate(phone, name, agency) {
  return axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "intro_marketing_agency",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: agency },
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
}
