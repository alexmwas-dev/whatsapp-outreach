import { ensurePlus } from "../utils/ensurePlus.js";
import { AppError } from "../utils/AppError.js";
import { sendLeadAssignedEmail } from "../lib/email.js";

export async function notifyRep({
  repEmail,
  repName,
  leadName,
  leadPhone,
  orgName,
}) {
  if (!repEmail) {
    throw new AppError("Sales rep email is missing", 400);
  }

  return sendLeadAssignedEmail({
    to: repEmail,
    repName,
    leadName,
    leadPhone: ensurePlus(leadPhone),
    orgName,
  });
}
