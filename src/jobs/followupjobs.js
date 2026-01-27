import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendFollowUpTemplate } from "../services/followUpSender.js";
import logger from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";

cron.schedule("0 * * * *", async () => {
  logger.info("Running follow-up cron job");

  try {
    const contacts = await prisma.contact.findMany({
      where: {
        status: "SAMPLES_SENT",
        samplesSentAt: {
          lt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
        },
      },
    });

    if (!contacts.length) {
      logger.debug("No contacts eligible for follow-up");
      return;
    }

    for (const contact of contacts) {
      try {
        logger.info("Sending follow-up", {
          meta: { contactId: contact.id, phone: contact.phone },
        });

        await sendFollowUpTemplate(contact.phone, contact.name);

        await prisma.$transaction([
          prisma.message.create({
            data: {
              contactId: contact.id,
              direction: "OUTBOUND",
              message: "Sent 48h follow-up template",
            },
          }),
          prisma.contact.update({
            where: { id: contact.id },
            data: { status: "FOLLOW_UP_SENT" },
          }),
        ]);

        logger.info("Follow-up completed", {
          meta: { contactId: contact.id },
        });
      } catch (contactError) {
        // Contact-level failure should NOT stop the cron
        logger.error("Follow-up failed for contact", {
          meta: {
            contactId: contact.id,
            error: contactError.message,
          },
        });
      }
    }
  } catch (error) {
    // Cron-level failure
    logger.error("Follow-up cron job failed", {
      meta: {
        error: error.message,
        stack: error.stack,
      },
    });
  }
});
