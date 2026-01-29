import { prisma } from "../lib/prisma.js";
import { sendTemplate } from "../services/whatsappService.js";
import { sleep } from "../utils/sleep.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";

/**
 * Send campaign using organization's active template and WhatsApp number
 * POST /campaigns/send
 * Body: {
 *   templateName?: string, // defaults to first active template
 *   limit?: number, // max contacts to send to (default 20)
 *   delay?: number // delay between messages in ms (default 60000)
 * }
 */
export const sendCampaign = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { campaignId, templateName, limit = 20, delay = 60000 } = req.body;

  if (!organizationId) throw new AppError("Organization not found", 400);

  // Step 1: Get WhatsApp number
  const waNumber = await prisma.whatsAppNumber.findFirst({
    where: { organizationId, active: true },
  });
  if (!waNumber) throw new AppError("No active WhatsApp number", 400);

  // Step 2: Get template
  let template;
  if (templateName) {
    template = await prisma.whatsAppTemplate.findFirst({
      where: { organizationId, name: templateName, active: true },
    });
    if (!template)
      throw new AppError(`Template "${templateName}" not found`, 404);
  } else {
    template = await prisma.whatsAppTemplate.findFirst({
      where: { organizationId, active: true },
    });
    if (!template) throw new AppError("No active template found", 400);
  }

  // Step 3: Get contacts
  let contacts;
  if (campaignId) {
    // Send to contacts in the campaign
    const campaignContacts = await prisma.campaignContact.findMany({
      where: { campaignId },
      include: { contact: true },
      take: limit,
    });
    contacts = campaignContacts.map((cc) => cc.contact);
  } else {
    // Send to NEW contacts
    contacts = await prisma.contact.findMany({
      where: { organizationId, status: "NEW" },
      take: limit,
    });
  }

  if (!contacts.length) throw new AppError("No contacts to send to", 404);

  // Step 4: Send messages
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const contact of contacts) {
    try {
      const cleanPhone = contact.phone.replace(/[^0-9+]/g, "");
      const phoneWithPlus = cleanPhone.startsWith("+")
        ? cleanPhone
        : "+" + cleanPhone;

      await sendTemplate({
        phone: phoneWithPlus,
        templateName: template.name,
        language: template.language,
        params: [contact.name],
        waNumber,
      });

      // Log in campaignContact if campaign exists
      if (campaignId) {
        await prisma.campaignContact.upsert({
          where: {
            campaignId_contactId: { campaignId, contactId: contact.id },
          },
          update: {},
          create: { campaignId, contactId: contact.id },
        });
      }

      await prisma.contact.update({
        where: { id: contact.id },
        data: { status: "INTRO_SENT" },
      });

      successCount++;
      if (contacts.indexOf(contact) < contacts.length - 1) await sleep(delay);
    } catch (err) {
      errorCount++;
      errors.push({
        contactId: contact.id,
        phone: contact.phone,
        error: err.message,
      });
    }
  }

  res.status(200).json({
    status: "success",
    data: {
      successCount,
      errorCount,
      total: contacts.length,
      template: template.name,
    },
  });
});

export const createContactAndAttachToCampaign = catchAsync(async (req, res) => {
  const { campaignId } = req.params;
  const { name, phone, email, salesRepId } = req.body;
  const { organizationId } = req.user; // assuming org comes from authenticated user

  if (!name || !phone) {
    throw new AppError("name and phone are required", 400);
  }

  // Step 1: Create the contact
  const contact = await prisma.contact.create({
    data: {
      name,
      phone,
      email,
      salesRepId: salesRepId || null,
      organizationId,
    },
  });

  // Step 2: Attach the contact to the campaign
  const campaignContact = await prisma.campaignContact.create({
    data: {
      campaignId,
      contactId: contact.id,
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
  const { organizationId } = req.user;
  const { name, description } = req.body;

  const campaign = await prisma.campaign.create({
    data: { organizationId, name, description },
  });

  res.status(201).json({ status: "success", data: campaign });
});

export const getAllCampaigns = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ status: "success", data: campaigns });
});

export const getCampaignById = catchAsync(async (req, res) => {
  const { campaignId } = req.params;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      contacts: {
        include: { contact: true },
      },
    },
  });

  if (!campaign) throw new AppError("Campaign not found", 404);

  res.status(200).json({ status: "success", data: campaign });
});

/**
 * Get campaign statistics
 * GET /campaigns/stats
 */
export const getCampaignStats = catchAsync(async (req, res) => {
  const { organizationId } = req.user;

  const stats = await prisma.contact.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: true,
  });

  const totalMessages = await prisma.message.count({
    where: { organizationId },
  });

  res.status(200).json({
    status: "success",
    data: {
      contactStats: stats,
      totalMessages,
      organizationId,
    },
  });
});
