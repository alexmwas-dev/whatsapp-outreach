import axios from "axios";
import { WHATSAPP_API_URL } from "../config/whatsapp.js";

export async function notifyRep(repPhone, leadName, leadPhone) {
  return axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: "whatsapp",
      to: repPhone,
      type: "text",
      text: {
        body:
          `📢 New Lead Assigned\n\n` +
          `Name: ${leadName}\n` +
          `Phone: ${leadPhone}\n\n` +
          `They’ve consented and received samples. Please follow up.`,
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
