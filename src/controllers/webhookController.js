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

  console.log("Env token:", JSON.stringify(process.env.VERIFY_TOKEN));
  console.log("Received token:", JSON.stringify(token));

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    logger.info("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  logger.warn("Webhook verification failed", {
    meta: { mode, token },
  });

  throw new AppError("Webhook verification failed", 403);
});

/**
 * Receive incoming WhatsApp messages
 */
export const receiveMessage = catchAsync(async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  // Meta requires 200 even if empty
  const value = req.body.entry?.[0]?.changes?.[0]?.value;

  if (value?.statuses) return res.sendStatus(200);
  if (!value?.messages) return res.sendStatus(200);

  const phone = message.from;
  const text = message.text?.body?.toLowerCase() || "";

  logger.http("Incoming WhatsApp message", { meta: { phone, text } });

  // Fetch contact
  const contact = await prisma.contact.findUnique({ where: { phone } });
  if (!contact) {
    logger.info("Message from unknown contact", { meta: { phone } });
    return res.sendStatus(200);
  }

  /* -------------------------------
     OPT-OUT
  ------------------------------- */
  if (
    text.includes("no") ||
    text.includes("stop") ||
    text.includes("not interested")
  ) {
    await prisma.$transaction([
      prisma.contact.update({ where: { phone }, data: { status: "CLOSED" } }),
      prisma.message.create({
        data: { contactId: contact.id, direction: "INBOUND", message: text },
      }),
    ]);
    logger.info("Contact opted out", {
      meta: { contactId: contact.id, phone },
    });
    return res.sendStatus(200);
  }

  /* -------------------------------
     CONSENT
  ------------------------------- */
  if (
    text.includes("yes") ||
    text.includes("sure") ||
    text.includes("ok") ||
    text.includes("okay")
  ) {
    // Only act if they haven’t consented yet
    if (!contact.consent) {
      // Log inbound message
      await prisma.message.create({
        data: { contactId: contact.id, direction: "INBOUND", message: text },
      });

      // Update contact consent
      const updatedContact = await prisma.contact.update({
        where: { phone },
        data: { consent: true, status: "CONSENTED" },
      });
      logger.info("Contact consented", { meta: { contactId: contact.id } });

      /* -------------------------------
         ASSIGN SALES REP
      ------------------------------- */
      if (!contact.salesRepId) {
        const reps = await prisma.salesRep.findMany({
          where: { active: true },
        });
        if (reps.length > 0) {
          const assignedRep = reps[Math.floor(Math.random() * reps.length)];

          await prisma.contact.update({
            where: { id: contact.id },
            data: { salesRepId: assignedRep.id, status: "ASSIGNED" },
          });

          logger.info("Sales rep assigned", {
            meta: { repId: assignedRep.id, contactId: contact.id },
          });

          // Notify rep that they now own a contact
          try {
            await notifyRep(
              assignedRep.phone,
              assignedRep.name,
              contact.name,
              contact.phone,
            );

            await prisma.message.create({
              data: {
                contactId: contact.id,
                direction: "OUTBOUND",
                message: `You have been assigned to contact ${contact.name}. Please follow up.`,
                salesRepId: assignedRep.id,
                whatsappNumberId: updatedContact.salesRep?.id || "", // optional if needed
              },
            });

            logger.info("Sales rep notified of new contact", {
              meta: { repPhone: assignedRep.phone },
            });
          } catch (err) {
            logger.error("Failed to notify sales rep", {
              repPhone: assignedRep.phone,
              contactId: contact.id,
              err,
            });
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  /* -------------------------------
     OTHER MESSAGES
  ------------------------------- */
  await prisma.message.create({
    data: { contactId: contact.id, direction: "INBOUND", message: text },
  });
  logger.debug("Unhandled inbound message", {
    meta: { contactId: contact.id, text },
  });

  return res.sendStatus(200);
});
