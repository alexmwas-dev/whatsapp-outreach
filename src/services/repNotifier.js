import axios from "axios";
import { WHATSAPP_API_URL } from "../config/whatsapp.js";

export async function notifyRep(repPhone, repName, leadName, leadPhone) {
  return axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: "whatsapp",
      to: repPhone,
      type: "template",
      template: {
        name: "lead_assigned_notification",
        language: {
          code: "en", // or "en_US" if that’s what you picked in Meta
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: repName, // {{1}}
              },
              {
                type: "text",
                text: leadName, // {{2}}
              },
              {
                type: "text",
                text: leadPhone, // {{3}}
              },
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
