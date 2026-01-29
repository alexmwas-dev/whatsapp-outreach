import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";

/**
 * Get all WhatsApp templates for organization
 */
export const getWhatsAppTemplates = catchAsync(async (req, res) => {
  const { organizationId } = req.user;

  const templates = await prisma.whatsAppTemplate.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({
    status: "success",
    data: templates,
  });
});

/**
 * Get single WhatsApp template
 */
export const getWhatsAppTemplate = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { templateId } = req.params;

  const template = await prisma.whatsAppTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new AppError("Template not found", 404);
  }

  if (template.organizationId !== organizationId) {
    throw new AppError("You do not have permission to view this template", 403);
  }

  res.status(200).json({
    status: "success",
    data: template,
  });
});

/**
 * Create WhatsApp template
 * Body: {
 *   name: string,
 *   language: string,
 *   category: string,
 *   description?: string
 * }
 */
export const createWhatsAppTemplate = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { name, language, category, description } = req.body;

  // Validation
  if (!name || !language || !category) {
    throw new AppError("name, language, and category are required fields", 400);
  }

  // Check for duplicate template name within organization
  const existingTemplate = await prisma.whatsAppTemplate.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name,
      },
    },
  });

  if (existingTemplate) {
    throw new AppError(
      "Template with this name already exists in your organization",
      409,
    );
  }

  const template = await prisma.whatsAppTemplate.create({
    data: {
      organizationId,
      name,
      language,
      category,
      description,
      active: true,
    },
  });

  logger.info("WhatsApp template created", {
    meta: { templateId: template.id, name },
  });

  res.status(201).json({
    status: "success",
    data: template,
  });
});

/**
 * Update WhatsApp template
 * Body: {
 *   description?: string,
 *   language?: string,
 *   category?: string
 * }
 */
export const updateWhatsAppTemplate = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { templateId } = req.params;
  const { description, language, category } = req.body;

  const template = await prisma.whatsAppTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new AppError("Template not found", 404);
  }

  if (template.organizationId !== organizationId) {
    throw new AppError(
      "You do not have permission to update this template",
      403,
    );
  }

  const updatedTemplate = await prisma.whatsAppTemplate.update({
    where: { id: templateId },
    data: {
      ...(description !== undefined && { description }),
      ...(language !== undefined && { language }),
      ...(category !== undefined && { category }),
    },
  });

  logger.info("WhatsApp template updated", {
    meta: { templateId },
  });

  res.status(200).json({
    status: "success",
    data: updatedTemplate,
  });
});

/**
 * Toggle template active/inactive status
 */
export const toggleWhatsAppTemplateStatus = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { templateId } = req.params;

  const template = await prisma.whatsAppTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new AppError("Template not found", 404);
  }

  if (template.organizationId !== organizationId) {
    throw new AppError(
      "You do not have permission to toggle this template",
      403,
    );
  }

  const updatedTemplate = await prisma.whatsAppTemplate.update({
    where: { id: templateId },
    data: {
      active: !template.active,
    },
  });

  logger.info("WhatsApp template status toggled", {
    meta: { templateId, active: updatedTemplate.active },
  });

  res.status(200).json({
    status: "success",
    data: updatedTemplate,
  });
});

/**
 * Delete WhatsApp template
 */
export const deleteWhatsAppTemplate = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { templateId } = req.params;

  const template = await prisma.whatsAppTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new AppError("Template not found", 404);
  }

  if (template.organizationId !== organizationId) {
    throw new AppError(
      "You do not have permission to delete this template",
      403,
    );
  }

  // Check if template has associated campaigns (if implemented)
  // For now, just delete the template

  await prisma.whatsAppTemplate.delete({
    where: { id: templateId },
  });

  logger.info("WhatsApp template deleted", {
    meta: { templateId, name: template.name },
  });

  res.status(200).json({
    status: "success",
    message: "Template deleted successfully",
  });
});
