import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { triggerCampaignWorker } from "../workers/campaignWorker.js";
import {
  getSubscriptionUsage,
  getQuotaErrorMessage,
} from "../services/subscriptionService.js";

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELED"]);

async function resolveTemplateForCampaign({
  organizationId,
  templateId,
  templateName,
  campaign,
}) {
  let template = null;

  if (templateId) {
    template = await prisma.whatsAppTemplate.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) throw new AppError("Template not found", 404);
  } else if (templateName) {
    template = await prisma.whatsAppTemplate.findFirst({
      where: { organizationId, name: templateName, active: true },
    });
    if (!template)
      throw new AppError(`Template \"${templateName}\" not found`, 404);
  } else if (campaign?.templateId) {
    template = await prisma.whatsAppTemplate.findFirst({
      where: { id: campaign.templateId, organizationId },
    });
  } else if (campaign?.templateName) {
    template = await prisma.whatsAppTemplate.findFirst({
      where: {
        organizationId,
        name: campaign.templateName,
        active: true,
      },
    });
  } else {
    template = await prisma.whatsAppTemplate.findFirst({
      where: { organizationId, active: true },
    });
  }

  if (!template) throw new AppError("No active template found", 400);

  if (template.status && template.status !== "APPROVED") {
    throw new AppError("Template is not approved by Meta", 400);
  }

  return template;
}

function displayStatus(campaign) {
  return campaign.state || campaign.status || "DRAFT";
}

function withPresentationFields(campaign) {
  return {
    ...campaign,
    status: displayStatus(campaign),
  };
}

/**
 * Queue campaign for worker processing
 * POST /campaign/send
 */
export const sendCampaign = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { campaignId, templateId, templateName, limit, delay = 500 } = req.body;

  if (!organizationId) throw new AppError("Organization not found", 400);
  if (!campaignId) throw new AppError("campaignId is required", 400);

  const waNumber = await prisma.whatsAppNumber.findFirst({
    where: { organizationId, active: true },
  });
  if (!waNumber) throw new AppError("No active WhatsApp number", 400);

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { contacts: { select: { id: true } } },
  });

  if (!campaign) throw new AppError("Campaign not found", 404);

  const template = await resolveTemplateForCampaign({
    organizationId,
    templateId,
    templateName,
    campaign,
  });

  if (!campaign.contacts.length) {
    throw new AppError("Campaign has no contacts", 400);
  }

  if (["QUEUED", "SENDING"].includes(campaign.state)) {
    return res.status(200).json({
      status: "success",
      data: {
        campaignId,
        jobId: campaignId,
        status: campaign.state,
      },
    });
  }

  const usage = await getSubscriptionUsage(organizationId);
  if (!usage.canSend) {
    throw new AppError(getQuotaErrorMessage(usage.subscription), 402);
  }

  const requestedLimit =
    limit === undefined || limit === null || Number.isNaN(Number(limit))
      ? null
      : Math.max(1, Number(limit));

  const effectiveLimit = requestedLimit
    ? Math.min(requestedLimit, usage.remaining)
    : Math.min(campaign.contacts.length, usage.remaining);

  if (!effectiveLimit || effectiveLimit <= 0) {
    throw new AppError(getQuotaErrorMessage(usage.subscription), 402);
  }

  const shouldResetProgress = campaign.state !== "PAUSED";

  await prisma.$transaction(async (tx) => {
    if (shouldResetProgress) {
      await tx.campaignContact.updateMany({
        where: { campaignId },
        data: {
          sendStatus: "PENDING",
          sendAttempts: 0,
          lastAttemptAt: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          lastError: null,
          outboundMessageId: null,
        },
      });
    }

    await tx.campaign.update({
      where: { id: campaignId },
      data: {
        templateId: template.id,
        templateName: template.name,
        state: "QUEUED",
        status: "SENDING",
        queueRequestedAt: new Date(),
        pausedAt: null,
        canceledAt: null,
        completedAt: null,
        sendDelayMs: Number.isFinite(Number(delay))
          ? Math.max(0, Number(delay))
          : 500,
        sendLimit: effectiveLimit,
        lastError: null,
        ...(shouldResetProgress
          ? {
              messagesSent: 0,
              messagesDelivered: 0,
              messagesRead: 0,
              messagesFailed: 0,
              startedAt: null,
            }
          : {}),
      },
    });
  });

  triggerCampaignWorker();

  res.status(202).json({
    status: "success",
    data: {
      campaignId,
      jobId: campaignId,
      status: "QUEUED",
      sendLimit: effectiveLimit,
      remainingMessagesAfterQueue: Math.max(0, usage.remaining - effectiveLimit),
    },
  });
});

export const pauseCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { organizationId } = req.user;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new AppError("Campaign not found", 404);

  if (!["QUEUED", "SENDING"].includes(campaign.state)) {
    throw new AppError("Only queued or sending campaigns can be paused", 400);
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      state: "PAUSED",
      pausedAt: new Date(),
    },
  });

  res
    .status(200)
    .json({ status: "success", data: withPresentationFields(updated) });
});

export const resumeCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { organizationId } = req.user;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new AppError("Campaign not found", 404);

  if (!["PAUSED", "FAILED"].includes(campaign.state)) {
    throw new AppError("Only paused or failed campaigns can be resumed", 400);
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      state: "QUEUED",
      status: "SENDING",
      queueRequestedAt: new Date(),
      pausedAt: null,
      canceledAt: null,
      completedAt: null,
      lastError: null,
    },
  });

  triggerCampaignWorker();

  res
    .status(200)
    .json({ status: "success", data: withPresentationFields(updated) });
});

export const cancelCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { organizationId } = req.user;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new AppError("Campaign not found", 404);

  if (TERMINAL_STATES.has(campaign.state)) {
    return res.status(200).json({
      status: "success",
      data: withPresentationFields(campaign),
    });
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      state: "CANCELED",
      status: "COMPLETED",
      canceledAt: new Date(),
      completedAt: new Date(),
    },
  });

  res
    .status(200)
    .json({ status: "success", data: withPresentationFields(updated) });
});

export const resendCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { organizationId } = req.user;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new AppError("Campaign not found", 404);

  if (campaign.state !== "COMPLETED") {
    throw new AppError("Only completed campaigns can be resent", 400);
  }

  req.body = { ...req.body, campaignId };
  return sendCampaign(req, res);
});

export const deleteCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { organizationId } = req.user;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new AppError("Campaign not found", 404);

  if (["QUEUED", "SENDING"].includes(campaign.state)) {
    throw new AppError("Pause or cancel the campaign before deleting", 400);
  }

  await prisma.campaign.delete({
    where: { id: campaignId },
  });

  res.status(200).json({
    status: "success",
    data: { id: campaignId },
  });
});

export const createContactAndAttachToCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { name, phone, email, salesRepId } = req.body;
  const { organizationId } = req.user;

  if (!name || !phone) {
    throw new AppError("name and phone are required", 400);
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true },
  });

  if (!campaign) throw new AppError("Campaign not found", 404);

  const contact = await prisma.contact.create({
    data: {
      name,
      phone,
      email,
      salesRepId: salesRepId || null,
      organizationId,
    },
  });

  const campaignContact = await prisma.campaignContact.create({
    data: {
      campaignId,
      contactId: contact.id,
      sendStatus: "PENDING",
    },
  });

  res.status(201).json({
    status: "success",
    data: {
      contact,
      campaignContact,
    },
  });
});

export const createCampaign = catchAsync(async (req, res) => {
  const organizationId = req.user?.organizationId || req.organization?.id;
  if (!organizationId) throw new AppError("Organization not found", 400);

  const { name, description, templateId } = req.body;
  if (!name) throw new AppError("Campaign name is required", 400);

  let templateName;
  if (templateId) {
    const template = await prisma.whatsAppTemplate.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) throw new AppError("Template not found", 404);
    templateName = template.name;
  }

  const createData = {
    organizationId,
    name,
    description,
    state: "DRAFT",
  };

  if (templateId) {
    createData.templateId = templateId;
    createData.templateName = templateName;
  }

  const campaign = await prisma.campaign.create({ data: createData });

  res
    .status(201)
    .json({ status: "success", data: withPresentationFields(campaign) });
});

export const getAllCampaigns = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      contacts: {
        select: { contactId: true },
      },
    },
  });

  const campaignsWithStats = campaigns.map((campaign) => {
    const contactIds = campaign.contacts.map((c) => c.contactId);
    const { contacts, ...campaignData } = campaign;
    return withPresentationFields({
      ...campaignData,
      contactIds,
      totalContacts: contactIds.length,
      messagesSent: campaign.messagesSent,
      messagesDelivered: campaign.messagesDelivered,
      messagesRead: campaign.messagesRead,
      messagesFailed: campaign.messagesFailed,
    });
  });

  res.status(200).json({ status: "success", data: campaignsWithStats });
});

export const getCampaignById = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { organizationId } = req.user;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: {
      contacts: {
        include: { contact: true },
      },
    },
  });

  if (!campaign) throw new AppError("Campaign not found", 404);

  const contactIds = campaign.contacts.map((c) => c.contactId);

  res.status(200).json({
    status: "success",
    data: withPresentationFields({
      ...campaign,
      totalContacts: contactIds.length,
      messagesSent: campaign.messagesSent,
      messagesDelivered: campaign.messagesDelivered,
      messagesRead: campaign.messagesRead,
      messagesFailed: campaign.messagesFailed,
    }),
  });
});

/**
 * Get campaign statistics
 * GET /campaign/stats
 */
export const getCampaignStats = catchAsync(async (req, res) => {
  const { organizationId } = req.user;

  const [totalCampaigns, activeCampaigns, totals] = await Promise.all([
    prisma.campaign.count({
      where: { organizationId },
    }),
    prisma.campaign.count({
      where: { organizationId, state: { in: ["QUEUED", "SENDING"] } },
    }),
    prisma.campaign.aggregate({
      where: { organizationId },
      _sum: {
        messagesSent: true,
        messagesDelivered: true,
        messagesRead: true,
      },
    }),
  ]);

  const totalMessagesSent = totals._sum.messagesSent ?? 0;
  const totalMessagesDelivered = totals._sum.messagesDelivered ?? 0;
  const totalMessagesRead = totals._sum.messagesRead ?? 0;

  const deliveryRate = totalMessagesSent
    ? Number(((totalMessagesDelivered / totalMessagesSent) * 100).toFixed(1))
    : 0;
  const readRate = totalMessagesDelivered
    ? Number(((totalMessagesRead / totalMessagesDelivered) * 100).toFixed(1))
    : 0;

  res.status(200).json({
    status: "success",
    data: {
      totalCampaigns,
      activeCampaigns,
      totalMessagesSent,
      deliveryRate,
      readRate,
    },
  });
});
