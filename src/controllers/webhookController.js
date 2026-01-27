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

  if (value?.statuses) {
    logger.debug("Webhook status update", {
      meta: { status: value.statuses[0].status },
    });
    return res.sendStatus(200);
  }

  if (!value?.messages) {
    logger.debug("Webhook event without message");
    return res.sendStatus(200);
  }

  const phone = message.from;
  const text = message.text?.body?.toLowerCase() || "";

  logger.http("Incoming WhatsApp message", {
    meta: { phone, text },
  });

  // Fetch contact
  const contact = await prisma.contact.findUnique({
    where: { phone },
  });

  if (!contact) {
    logger.info("Message from unknown contact", { meta: { phone } });
    return res.sendStatus(200);
  }

  /* ----------------------------------
     HANDLE OPT-OUT / NO
  ---------------------------------- */
  if (
    text.includes("no") ||
    text.includes("not interested") ||
    text.includes("stop")
  ) {
    logger.info("Contact opted out", {
      meta: { contactId: contact.id, phone },
    });

    await prisma.$transaction([
      prisma.contact.update({
        where: { phone },
        data: { status: "CLOSED" },
      }),
      prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "INBOUND",
          message: text,
        },
      }),
    ]);

    return res.sendStatus(200);
  }

  /* ----------------------------------
     HANDLE CONSENT / YES
  ---------------------------------- */
  if (
    text.includes("yes") ||
    text.includes("sure") ||
    text.includes("okay") ||
    text.includes("ok")
  ) {
    if (!contact.consent && contact.status !== "SAMPLES_SENT") {
      logger.info("Contact consented", {
        meta: { contactId: contact.id },
      });

      // Log inbound
      await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "INBOUND",
          message: text,
        },
      });

      // Update consent
      await prisma.contact.update({
        where: { phone },
        data: {
          consent: true,
          status: "CONSENTED",
        },
      });

      /* ----------------------------------
         AUTO-ASSIGN SALES REP
      ---------------------------------- */
      const reps = await prisma.salesRep.findMany({
        where: { active: true },
      });

      let assignedRep = null;

      if (reps.length) {
        assignedRep = reps[Math.floor(Math.random() * reps.length)];

        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            salesRepId: assignedRep.id,
          },
        });

        logger.info("Sales rep assigned", {
          meta: {
            repId: assignedRep.id,
            contactId: contact.id,
          },
        });
      }

      // Send samples
      try {
        await sendSamples(phone);
        await prisma.message.create({
          data: {
            contactId: contact.id,
            direction: "OUTBOUND",
            message: "Sent video samples",
          },
        });

        logger.info("Samples sent", { meta: { contactId: contact.id } });
      } catch (err) {
        logger.error("Failed to send samples", { contactId: contact.id, err });
      }

      await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "OUTBOUND",
          message: "Sent video samples",
        },
      });

      logger.info("Samples sent", {
        meta: { contactId: contact.id },
      });

      // Notify rep
      if (assignedRep) {
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
              message: `Rep notified: ${assignedRep.name}`,
            },
          });

          logger.info("Sales rep notified", {
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
      // Final status
      await prisma.contact.update({
        where: { phone },
        data: {
          status: "SAMPLES_SENT",
          samplesSentAt: new Date(),
        },
      });
    }

    return res.sendStatus(200);
  }

  /* ----------------------------------
     HANDLE OTHER MESSAGES
  ---------------------------------- */
  logger.debug("Unhandled inbound message", {
    meta: { contactId: contact.id, text },
  });

  await prisma.message.create({
    data: {
      contactId: contact.id,
      direction: "INBOUND",
      message: text,
    },
  });

  return res.sendStatus(200);
});
