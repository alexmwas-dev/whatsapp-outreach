import { prisma } from "../lib/prisma.js";
import {
  sendHelloWorldTemplate,
  sendIntroTemplate,
} from "../services/whatsappService.js";
import { sleep } from "../utils/sleep.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";

export const sendCampaign = catchAsync(async (req, res) => {
  const { agencyName } = req.body;

  if (!agencyName) {
    logger.warn("Campaign started without agency name");
    throw new AppError("Agency name is required", 400);
  }

  logger.info("Campaign started", { meta: { agencyName } });

  const contacts = await prisma.contact.findMany({
    where: { status: "NEW" },
    take: 20,
  });

  if (!contacts.length) {
    logger.info("No NEW contacts found");
    throw new AppError("No new contacts available", 404);
  }

  for (const contact of contacts) {
    logger.debug("Sending WhatsApp intro", {
      meta: {
        contactId: contact.id,
        phone: contact.phone,
      },
    });
    const cleanPhone = contact.phone.replace(/[^0-9]/g, ""); // remove everything except digits
    const phoneWithPlus = "+" + cleanPhone;
    // await sendHelloWorldTemplate(phoneWithPlus);

    console.log("Sending intro to:", phoneWithPlus);
    console.log("Agency name:", agencyName);
    console.log("Contact name:", contact.name);

    await sendIntroTemplate(
      phoneWithPlus,
      contact.name,
      "Kham Japher",
      agencyName,
    );

    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        status: "INTRO_SENT",
        // last_message_at: new Date(),
      },
    });

    await sleep(60000);
  }

  logger.info("Campaign completed", {
    meta: { sent: contacts.length },
  });

  res.json({ sent: contacts.length });
});
