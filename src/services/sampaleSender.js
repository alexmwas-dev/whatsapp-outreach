import axios from "axios";
import { WHATSAPP_API_URL } from "../config/whatsapp.js";

export async function sendSamples(phone) {
  return axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: {
        body: "Great! 🎉\n\nHere are a few short video samples we’ve created for clients:\nhttps://yourportfolio.com\n\nLet me know if you’d like something similar for your business.",
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
