import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { sendTemplate } from "../services/whatsappService.js";
import { ensurePlus } from "../utils/ensurePlus.js";
import { sleep } from "../utils/sleep.js";
import logger from "../utils/loogger.js";
import {
  resolveTemplateParams,
  extractTemplateVariableCount,
} from "../utils/templateParamResolver.js";
import {
  reserveMessageQuota,
  releaseReservedMessageQuota,
  getQuotaErrorMessage,
} from "../services/subscriptionService.js";

const LOCK_STALE_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;
const MAX_CONCURRENT_CAMPAIGNS = 3;
const MAX_ATTEMPTS = 3;

const activeCampaigns = new Set();
let schedulerStarted = false;
let schedulerRunning = false;
let schedulerTimer = null;
let lastSchemaErrorLogAt = 0;

function isRetriable(err) {
  const status = err?.response?.status;
  return status === 429 || (status >= 500 && status < 600);
}

async function releaseLock(campaignId, lockId) {
  await prisma.campaign.updateMany({
    where: { id: campaignId, workerLockId: lockId },
    data: { workerLockId: null, workerLockedAt: null },
  });
}

async function claimNextCampaign() {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const candidate = await prisma.campaign.findFirst({
    where: {
      state: { in: ["QUEUED", "SENDING"] },
      OR: [{ workerLockId: null }, { workerLockedAt: { lt: staleBefore } }],
    },
    orderBy: [{ queueRequestedAt: "asc" }, { createdAt: "asc" }],
  });

  if (!candidate) return null;

  const lockId = randomUUID();
  const claim = await prisma.campaign.updateMany({
    where: {
      id: candidate.id,
      OR: [{ workerLockId: null }, { workerLockedAt: { lt: staleBefore } }],
    },
    data: {
      workerLockId: lockId,
      workerLockedAt: new Date(),
      state: "SENDING",
      status: "SENDING",
      startedAt: candidate.startedAt ?? new Date(),
      pausedAt: null,
      lastError: null,
    },
  });

  if (claim.count === 0) return null;
  return { campaignId: candidate.id, lockId };
}

async function claimNextContact(campaignId) {
  while (true) {
    const candidate = await prisma.campaignContact.findFirst({
      where: {
        campaignId,
        sendStatus: { in: ["PENDING", "FAILED"] },
      },
      orderBy: { assignedAt: "asc" },
      include: { contact: true },
    });

    if (!candidate) return null;

    if (candidate.sendAttempts >= MAX_ATTEMPTS) {
      await prisma.campaignContact.update({
        where: { id: candidate.id },
        data: { sendStatus: "FAILED", lastError: "Max attempts reached" },
      });
      continue;
    }

    const claimed = await prisma.campaignContact.updateMany({
      where: {
        id: candidate.id,
        sendStatus: candidate.sendStatus,
      },
      data: {
        sendStatus: "SENDING",
        sendAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: null,
      },
    });

    if (claimed.count === 0) continue;

    return {
      ...candidate,
      nextAttempt: candidate.sendAttempts + 1,
    };
  }
}

async function finalizeCampaign(campaignId, lockId, data) {
  await prisma.campaign.updateMany({
    where: { id: campaignId, workerLockId: lockId },
    data: {
      ...data,
      workerLockId: null,
      workerLockedAt: null,
      lastProgressAt: new Date(),
    },
  });
}

async function processCampaign(campaignId, lockId) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.workerLockId !== lockId) return;

    const org = await prisma.organization.findUnique({
      where: { id: campaign.organizationId },
    });

    const waNumber = await prisma.whatsAppNumber.findFirst({
      where: { organizationId: campaign.organizationId, active: true },
    });
    if (!waNumber) {
      await finalizeCampaign(campaignId, lockId, {
        state: "FAILED",
        status: "COMPLETED",
        completedAt: new Date(),
        lastError: "No active WhatsApp number",
      });
      return;
    }

    let template = null;
    if (campaign.templateId) {
      template = await prisma.whatsAppTemplate.findFirst({
        where: {
          id: campaign.templateId,
          organizationId: campaign.organizationId,
        },
      });
    }
    if (!template && campaign.templateName) {
      template = await prisma.whatsAppTemplate.findFirst({
        where: {
          organizationId: campaign.organizationId,
          name: campaign.templateName,
          active: true,
        },
      });
    }
    if (!template) {
      template = await prisma.whatsAppTemplate.findFirst({
        where: { organizationId: campaign.organizationId, active: true },
      });
    }

    if (!template) {
      await finalizeCampaign(campaignId, lockId, {
        state: "FAILED",
        status: "COMPLETED",
        completedAt: new Date(),
        lastError: "No active template found",
      });
      return;
    }

    if (template.status && template.status !== "APPROVED") {
      await finalizeCampaign(campaignId, lockId, {
        state: "FAILED",
        status: "COMPLETED",
        completedAt: new Date(),
        lastError: "Template is not approved by Meta",
      });
      return;
    }

    await prisma.campaign.updateMany({
      where: { id: campaignId, workerLockId: lockId },
      data: {
        templateId: template.id,
        templateName: template.name,
      },
    });

    while (true) {
      const liveCampaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (!liveCampaign || liveCampaign.workerLockId !== lockId) return;

      if (liveCampaign.state === "PAUSED") {
        await releaseLock(campaignId, lockId);
        return;
      }

      if (liveCampaign.state === "CANCELED") {
        await finalizeCampaign(campaignId, lockId, {
          status: "COMPLETED",
          completedAt: new Date(),
        });
        return;
      }

      const processedCount =
        (liveCampaign.messagesSent ?? 0) + (liveCampaign.messagesFailed ?? 0);
      if (liveCampaign.sendLimit && processedCount >= liveCampaign.sendLimit) {
        await finalizeCampaign(campaignId, lockId, {
          state: "COMPLETED",
          status: "COMPLETED",
          completedAt: new Date(),
        });
        return;
      }

      const claimed = await claimNextContact(campaignId);
      if (!claimed) {
        await finalizeCampaign(campaignId, lockId, {
          state: "COMPLETED",
          status: "COMPLETED",
          completedAt: new Date(),
        });
        return;
      }

      const contact = claimed.contact;
      const quotaReservation = await reserveMessageQuota({
        organizationId: campaign.organizationId,
        amount: 1,
      });

      if (!quotaReservation.ok) {
        const quotaError = getQuotaErrorMessage(quotaReservation.subscription);

        await prisma.campaignContact.update({
          where: { id: claimed.id },
          data: {
            sendStatus: "PENDING",
            lastError: quotaError,
          },
        });

        await finalizeCampaign(campaignId, lockId, {
          state: "PAUSED",
          status: "SENDING",
          pausedAt: new Date(),
          lastError: quotaError,
        });
        return;
      }

      let sentToWhatsApp = false;

      try {
        let params = resolveTemplateParams({
          template,
          contact,
          org,
          waNumber,
          campaign: liveCampaign,
        });
        const expectedParams = extractTemplateVariableCount(template);

        if (params.length === 0 && expectedParams > 0) {
          const fallback = [
            contact?.name || "",
            waNumber?.displayName || "",
            org?.name || "",
            liveCampaign?.name || "",
          ];
          params = fallback
            .slice(0, expectedParams)
            .map((v) => String(v ?? ""));
        }

        const sendResp = await sendTemplate({
          phone: ensurePlus(contact.phone),
          templateName: template.name,
          language: template.language,
          params,
          expectedParams,
          waNumber,
          organizationId: campaign.organizationId,
        });
        sentToWhatsApp = true;

        const outboundMessageId = sendResp?.messages?.[0]?.id || null;

        await prisma.$transaction([
          prisma.campaignContact.update({
            where: { id: claimed.id },
            data: {
              sendStatus: "SENT",
              sentAt: new Date(),
              lastError: null,
              outboundMessageId,
            },
          }),
          prisma.contact.update({
            where: { id: contact.id },
            data: { status: "INTRO_SENT" },
          }),
          prisma.campaign.update({
            where: { id: campaignId },
            data: {
              messagesSent: { increment: 1 },
              lastProgressAt: new Date(),
            },
          }),
        ]);
      } catch (err) {
        if (!sentToWhatsApp) {
          await releaseReservedMessageQuota({
            organizationId: campaign.organizationId,
            amount: 1,
          }).catch(() => {});
        }

        const retriable = isRetriable(err);
        const hasRetryLeft = claimed.nextAttempt < MAX_ATTEMPTS;

        if (retriable && hasRetryLeft) {
          await prisma.campaignContact.update({
            where: { id: claimed.id },
            data: {
              sendStatus: "PENDING",
              lastError: err?.message || "Transient send failure",
            },
          });

          const retryBackoff = Math.min(10000, 1000 * claimed.nextAttempt);
          await sleep(retryBackoff);
          continue;
        }

        await prisma.$transaction([
          prisma.campaignContact.update({
            where: { id: claimed.id },
            data: {
              sendStatus: "FAILED",
              lastError: err?.message || "Send failed",
            },
          }),
          prisma.campaign.update({
            where: { id: campaignId },
            data: {
              messagesFailed: { increment: 1 },
              lastError: err?.message || "Send failed",
              lastProgressAt: new Date(),
            },
          }),
        ]);

        logger.error("Campaign send failed", {
          campaignId,
          contactId: contact.id,
          error: err?.message,
          status: err?.response?.status,
          metaError: err?.response?.data,
        });
      }

      await prisma.campaign.updateMany({
        where: { id: campaignId, workerLockId: lockId },
        data: { workerLockedAt: new Date() },
      });

      const pauseAfter = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (!pauseAfter || pauseAfter.state !== "SENDING") {
        await releaseLock(campaignId, lockId);
        return;
      }

      const delayMs = Math.max(0, pauseAfter.sendDelayMs ?? 500);
      if (delayMs > 0) await sleep(delayMs);
    }
  } catch (err) {
    logger.error("Campaign worker crashed", {
      campaignId,
      error: err?.message,
      stack: err?.stack,
    });

    await finalizeCampaign(campaignId, lockId, {
      state: "FAILED",
      status: "COMPLETED",
      completedAt: new Date(),
      lastError: err?.message || "Worker crashed",
    }).catch(() => {});
  } finally {
    activeCampaigns.delete(campaignId);
  }
}

async function tickCampaignWorker() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  try {
    while (activeCampaigns.size < MAX_CONCURRENT_CAMPAIGNS) {
      const next = await claimNextCampaign();
      if (!next) break;
      if (activeCampaigns.has(next.campaignId)) {
        await releaseLock(next.campaignId, next.lockId);
        continue;
      }

      activeCampaigns.add(next.campaignId);
      void processCampaign(next.campaignId, next.lockId);
    }
  } catch (err) {
    // If migrations are not applied yet, avoid crashing/flooding logs every tick.
    if (err?.code === "P2022") {
      const now = Date.now();
      if (now - lastSchemaErrorLogAt > 15000) {
        logger.error("Campaign worker schema mismatch (run DB migrations)", {
          meta: { code: err.code, message: err.message },
        });
        lastSchemaErrorLogAt = now;
      }
      return;
    }

    logger.error("Campaign worker scheduler tick failed", {
      meta: { message: err?.message, stack: err?.stack },
    });
  } finally {
    schedulerRunning = false;
  }
}

export function triggerCampaignWorker() {
  void tickCampaignWorker();
}

export function startCampaignWorker() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerTimer = setInterval(() => {
    void tickCampaignWorker();
  }, POLL_INTERVAL_MS);

  if (typeof schedulerTimer.unref === "function") {
    schedulerTimer.unref();
  }

  void tickCampaignWorker();
  logger.info("Campaign worker started", {
    meta: {
      pollIntervalMs: POLL_INTERVAL_MS,
      maxConcurrentCampaigns: MAX_CONCURRENT_CAMPAIGNS,
    },
  });
}
