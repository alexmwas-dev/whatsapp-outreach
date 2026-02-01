import { prisma } from "../lib/prisma.js";
import { notifyRep } from "../services/repNotifier.js";
import { sendSamples } from "../services/sampaleSender.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
// import logger from "../utils/logger.js";

/**
 * Webhook verification (Meta requirement)
 */
export const verifyWebhook = catchAsync(async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Check mode
  if (mode !== "subscribe") {
    throw new AppError("Invalid mode", 400);
  }

  // Look up organization by token
  const org = await prisma.organization.findFirst({
    where: { webhookVerifyToken: token },
  });

  if (!org) {
    throw new AppError("Invalid verify token", 403);
  }

  // ✅ Mark WhatsApp as VERIFIED
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      whatsappStatus: "VERIFIED",
      whatsappStepsCompleted: {
        push: "WEBHOOK_CONFIGURED",
      },
    },
  });

  logger.info("Webhook verified successfully", { orgId: org.id });

  // Respond with challenge (Meta expects plain text)
  return res.status(200).send(challenge);
});

/**
 * Receive incoming WhatsApp messages
 */
export const receiveMessage = catchAsync(async (req, res) => {
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  // Meta requires 200 even if empty
  if (!value) return res.sendStatus(200);

  // Status updates (delivery / read receipts)
  if (value.statuses) {
    logger.info("Webhook status update", { meta: value.statuses });
    return res.sendStatus(200);
  }

  if (!message) return res.sendStatus(200);

  /* --------------------------------
     RESOLVE WHATSAPP NUMBER
  --------------------------------- */
  const phoneNumberId = value?.metadata?.phone_number_id;

  const whatsappNumber = await prisma.whatsAppNumber.findUnique({
    where: { phoneNumberId },
  });

  if (!whatsappNumber) {
    logger.error("Incoming message for unknown WhatsApp number", {
      meta: { phoneNumberId },
    });
    return res.sendStatus(200);
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
    return res.sendStatus(200);
  }

  /* --------------------------------
     OPT-OUT
  --------------------------------- */
  if (
    text.includes("no") ||
    text.includes("stop") ||
    text.includes("not interested")
  ) {
    await prisma.$transaction([
      prisma.contact.update({
        where: { id: contact.id },
        data: { status: "DECLINED", consent: false },
      }),
      prisma.message.create({
        data: {
          organizationId: whatsappNumber.organizationId,
          whatsappNumberId: whatsappNumber.id,
          contactId: contact.id,
          direction: "INBOUND",
          message: text,
        },
      }),
    ]);

    logger.info("Contact opted out", {
      meta: { contactId: contact.id },
    });

    return res.sendStatus(200);
  }

  /* --------------------------------
     CONSENT
  --------------------------------- */
  if (["yes", "sure", "ok", "okay"].some((w) => text.includes(w))) {
    if (!contact.consent) {
      // Log inbound consent message
      await prisma.message.create({
        data: {
          organizationId: whatsappNumber.organizationId,
          whatsappNumberId: whatsappNumber.id,
          contactId: contact.id,
          direction: "INBOUND",
          message: text,
        },
      });

      let updatedContact = await prisma.contact.update({
        where: { id: contact.id },
        data: { consent: true, status: "CONSENTED" },
      });

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

          logger.info("Sales rep assigned", {
            meta: {
              repId: assignedRep.id,
              contactId: contact.id,
            },
          });

          try {
            await notifyRep({
              repPhone: assignedRep.phone,
              repName: assignedRep.name,
              leadName: updatedContact.name,
              leadPhone: updatedContact.phone,
              waNumber: whatsappNumber,
            });

            await prisma.message.create({
              data: {
                organizationId: whatsappNumber.organizationId,
                whatsappNumberId: whatsappNumber.id,
                contactId: contact.id,
                salesRepId: assignedRep.id,
                direction: "OUTBOUND",
                message: `You have been assigned to contact ${updatedContact.name}. Please follow up.`,
              },
            });

            logger.info("Sales rep notified", {
              meta: { repPhone: assignedRep.phone },
            });
          } catch (err) {
            logger.error("Failed to notify sales rep", {
              meta: {
                repPhone: assignedRep.phone,
                contactId: contact.id,
                err,
              },
            });
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  /* --------------------------------
     OTHER MESSAGES
  --------------------------------- */
  await prisma.message.create({
    data: {
      organizationId: whatsappNumber.organizationId,
      whatsappNumberId: whatsappNumber.id,
      contactId: contact.id,
      direction: "INBOUND",
      message: text,
    },
  });

  logger.debug("Unhandled inbound message", {
    meta: { contactId: contact.id, text },
  });

  return res.sendStatus(200);
});
