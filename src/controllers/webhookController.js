import { prisma } from "../lib/prisma.js";
import { notifyRep } from "../services/repNotifier.js";
import { sendSamples } from "../services/sampaleSender.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import { emitNewMessage, emitContactUpdate } from "../lib/socket.js";
// import logger from "../utils/logger.js";

/**
 * Webhook verification (Meta requirement)
 */
export const verifyWebhook = catchAsync(async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expectedVerifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  // Check mode
  if (mode !== "subscribe") {
    throw new AppError("Invalid mode", 400);
  }
  if (!expectedVerifyToken) {
    throw new AppError("WEBHOOK_VERIFY_TOKEN is not configured", 500);
  }
  if (token !== expectedVerifyToken) {
    throw new AppError("Invalid verify token", 403);
  }

  logger.info("Webhook verified successfully", {
    meta: { mode, usingGlobalVerifyToken: true },
  });

  // Respond with challenge (Meta expects plain text)
  return res.status(200).send(challenge);
});

/**
 * Receive incoming WhatsApp messages
 */
const processWebhookValue = async (value) => {
  const message = value?.messages?.[0];
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!value) return;

  const whatsappNumber = phoneNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { phoneNumberId },
      })
    : null;

  // Status updates (delivery / read receipts)
  if (value.statuses) {
    let matchedCount = 0;
    let unmatchedCount = 0;
    let deliveredIncrements = 0;
    let readIncrements = 0;

    for (const statusEvent of value.statuses) {
      const outboundMessageId = statusEvent?.id;
      const status = statusEvent?.status;
      const recipientId = statusEvent?.recipient_id;
      if (!status) continue;

      let campaignContact = null;
      if (outboundMessageId) {
        campaignContact = await prisma.campaignContact.findFirst({
          where: { outboundMessageId },
        });
      }

      // Fallback for old/partial data where outboundMessageId was not persisted.
      if (!campaignContact && recipientId) {
        const cleaned = String(recipientId).replace(/[^0-9]/g, "");
        const variants = cleaned ? [cleaned, `+${cleaned}`] : [];

        if (variants.length) {
          campaignContact = await prisma.campaignContact.findFirst({
            where: {
              sentAt: { not: null },
              contact: { phone: { in: variants } },
              ...(whatsappNumber
                ? { campaign: { organizationId: whatsappNumber.organizationId } }
                : {}),
            },
            orderBy: { sentAt: "desc" },
          });
        }
      }

      if (!campaignContact) {
        unmatchedCount++;
        continue;
      }
      matchedCount++;

      if (status === "delivered") {
        const delivered = await prisma.campaignContact.updateMany({
          where: { id: campaignContact.id, deliveredAt: null },
          data: { deliveredAt: new Date() },
        });

        if (delivered.count > 0) {
          deliveredIncrements += delivered.count;
          await prisma.campaign.update({
            where: { id: campaignContact.campaignId },
            data: { messagesDelivered: { increment: 1 } },
          });
        }
      }

      if (status === "read") {
        const read = await prisma.campaignContact.updateMany({
          where: { id: campaignContact.id, readAt: null },
          data: { readAt: new Date() },
        });

        if (read.count > 0) {
          readIncrements += read.count;
          const delivered = await prisma.campaignContact.updateMany({
            where: { id: campaignContact.id, deliveredAt: null },
            data: { deliveredAt: new Date() },
          });

          if (delivered.count > 0) {
            deliveredIncrements += delivered.count;
          }

          await prisma.campaign.update({
            where: { id: campaignContact.campaignId },
            data: {
              messagesRead: { increment: 1 },
              ...(delivered.count > 0
                ? { messagesDelivered: { increment: 1 } }
                : {}),
            },
          });
        }
      }
    }

    logger.info("Webhook status update processed", {
      meta: {
        statuses: value.statuses,
        matchedCount,
        unmatchedCount,
        deliveredIncrements,
        readIncrements,
      },
    });
  }

  // Meta can send statuses and messages together in the same change.
  if (!message) return;

  /* --------------------------------
     RESOLVE WHATSAPP NUMBER
  --------------------------------- */
  if (!whatsappNumber) {
    logger.error("Incoming message for unknown WhatsApp number", {
      meta: { phoneNumberId },
    });
    return;
  }

  /* --------------------------------
     NORMALIZE SENDER
  --------------------------------- */
  const rawFrom = message.from || "";
  const cleanedFrom = rawFrom.replace(/[^0-9]/g, "");
  const variants = [cleanedFrom, `+${cleanedFrom}`];

  const text = message.text?.body?.toLowerCase().trim() || "";

  logger.http("Incoming WhatsApp message", {
    meta: { from: rawFrom, cleanedFrom, text },
  });

  /* --------------------------------
     FIND CONTACT
  --------------------------------- */
  const contact = await prisma.contact.findFirst({
    where: {
      organizationId: whatsappNumber.organizationId,
      OR: variants.map((p) => ({ phone: p })),
    },
  });

  if (!contact) {
    logger.info("Message from unknown contact", {
      meta: { phone: cleanedFrom },
    });
    return;
  }

  /* --------------------------------
     OPT-OUT
  --------------------------------- */
  if (
    text.includes("no") ||
    text.includes("stop") ||
    text.includes("not interested")
  ) {
    const [updatedContact, newMessage] = await prisma.$transaction([
      prisma.contact.update({
        where: { id: contact.id },
        data: { status: "DECLINED", consent: false },
      }),
      prisma.message.create({
        data: {
          organizationId: whatsappNumber.organizationId,
          whatsappNumberId: whatsappNumber.id,
          contactId: contact.id,
          salesRepId: contact.salesRepId, // Include assigned rep if exists
          direction: "INBOUND",
          message: text,
        },
      }),
    ]);

    // Emit real-time events
    emitNewMessage(newMessage);
    emitContactUpdate(updatedContact);

    logger.info("Contact opted out", {
      meta: { contactId: contact.id },
    });

    return;
  }

  /* --------------------------------
     CONSENT
  --------------------------------- */
  if (["yes", "sure", "ok", "okay"].some((w) => text.includes(w))) {
    if (!contact.consent) {
      // Log inbound consent message
      const consentMessage = await prisma.message.create({
        data: {
          organizationId: whatsappNumber.organizationId,
          whatsappNumberId: whatsappNumber.id,
          contactId: contact.id,
          salesRepId: contact.salesRepId, // Include if already assigned
          direction: "INBOUND",
          message: text,
        },
      });

      // Emit real-time event
      emitNewMessage(consentMessage);

      let updatedContact = await prisma.contact.update({
        where: { id: contact.id },
        data: { consent: true, status: "CONSENTED" },
      });

      // Emit contact update
      emitContactUpdate(updatedContact);

      logger.info("Contact consented", {
        meta: { contactId: contact.id },
      });

      /* --------------------------------
         ASSIGN SALES REP
      --------------------------------- */
      if (!updatedContact.salesRepId) {
        const reps = await prisma.salesRep.findMany({
          where: {
            organizationId: whatsappNumber.organizationId,
            active: true,
          },
        });

        if (reps.length > 0) {
          const assignedRep = reps[Math.floor(Math.random() * reps.length)];

          updatedContact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
              salesRepId: assignedRep.id,
              status: "ASSIGNED",
            },
          });

          // Emit contact update
          emitContactUpdate(updatedContact);

          logger.info("Sales rep assigned", {
            meta: {
              repId: assignedRep.id,
              contactId: contact.id,
            },
          });

          try {
            const org = await prisma.organization.findUnique({
              where: { id: whatsappNumber.organizationId },
              select: { name: true },
            });

            await notifyRep({
              repEmail: assignedRep.email,
              repName: assignedRep.name,
              leadName: updatedContact.name,
              leadPhone: updatedContact.phone,
              orgName: org?.name || null,
            });

            logger.info("Sales rep notified", {
              meta: {
                repEmail: assignedRep.email,
                contactId: contact.id,
                leadName: updatedContact.name,
              },
            });
          } catch (err) {
            logger.error("Failed to notify sales rep", {
              meta: {
                repEmail: assignedRep.email,
                contactId: contact.id,
                error: err.message,
              },
            });
          }
        }
      }
    }

    return;
  }

  /* --------------------------------
     OTHER MESSAGES
  --------------------------------- */
  const inboundMessage = await prisma.message.create({
    data: {
      organizationId: whatsappNumber.organizationId,
      whatsappNumberId: whatsappNumber.id,
      contactId: contact.id,
      salesRepId: contact.salesRepId, // Link to assigned rep
      direction: "INBOUND",
      message: text,
    },
  });

  // Emit real-time event
  emitNewMessage(inboundMessage);

  logger.debug("Unhandled inbound message", {
    meta: { contactId: contact.id, text },
  });
};

export const receiveMessage = catchAsync(async (req, res) => {
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];

  // Meta requires 200 even if empty
  if (!entries.length) return res.sendStatus(200);

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      await processWebhookValue(change?.value);
    }
  }

  return res.sendStatus(200);
});
