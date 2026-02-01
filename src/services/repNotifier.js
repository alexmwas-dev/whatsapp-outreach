import { ensurePlus } from "../utils/ensurePlus.js";
import { sendTemplate } from "./whatsappService.js";

export async function notifyRep({
  repPhone,
  repName,
  leadName,
  leadPhone,
  waNumber,
}) {
  return sendTemplate({
    phone: ensurePlus(repPhone),
    templateName: "lead_assigned_notification",
    language: "en",
    expectedParams: 3,
    params: [repName, leadName, ensurePlus(leadPhone)],
    waNumber,
  });
}
