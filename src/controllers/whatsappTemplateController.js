import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import {
  normalizeTemplateName,
  buildMetaPayload,
} from "../utils/templateUtils.js";

const normalizeBodyParamKeys = (bodyParamKeys) => {
  if (!Array.isArray(bodyParamKeys)) return [];
  return bodyParamKeys.map((k) => (k == null ? "" : String(k)));
};

const extractVariableCount = (content) => {
  const variables = content.match(/{{\d+}}/g) || [];
  return variables.length;
};

const mapMetaStatusToTemplateStatus = (metaStatus) => {
  const normalized = String(metaStatus || "")
    .trim()
    .toUpperCase();

  if (normalized === "APPROVED") return "APPROVED";
  if (
    normalized === "REJECTED" ||
    normalized === "DISABLED" ||
    normalized === "PAUSED"
  ) {
    return "REJECTED";
  }
  return "PENDING";
};

/**
 * Get all WhatsApp templates for organization
 */
export const getWhatsAppTemplates = catchAsync(async (req, res) => {
  const { organizationId } = req.user;

  const templates = await prisma.whatsAppTemplate.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });

  const formattedTemplates = templates.map((template) => ({
    id: template.id,
    name: template.name,
    content: template.content ?? template.description ?? "",
    category: template.category,
    language: template.language,
    isActive: template.active,
    usageCount: template.usageCount,
    metaTemplateId: template.metaTemplateId ?? null,
    status: template.status ?? "PENDING",
    rejectionReason: template.rejectionReason ?? null,
    bodyParamsCount: template.bodyParamsCount ?? 0,
    bodyParamKeys: Array.isArray(template.bodyParamKeys)
      ? template.bodyParamKeys
      : [],
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }));

  res.status(200).json({
    status: "success",
    data: formattedTemplates,
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
  const {
    name,
    language,
    category,
    description,
    content: bodyContent,
    exampleValues,
    bodyParamKeys,
  } = req.body;

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

  // Normalize name to Meta requirements
  const normalized = normalizeTemplateName(name);

  // Prepare content field (prefer explicit content, fallback to description)
  const content = (bodyContent ?? description) || "";

  // ===== VARIABLE VALIDATION & COUNT (ADD HERE) =====
  // Extract and validate variables
  const variables = content.match(/{{\d+}}/g) || [];
  const varNumbers = variables.map((v) => parseInt(v.replace(/[{}]/g, ""), 10));
  const variableCount = variables.length;
  const normalizedBodyParamKeys = normalizeBodyParamKeys(bodyParamKeys);

  if (
    normalizedBodyParamKeys.length > 0 &&
    normalizedBodyParamKeys.length !== variableCount
  ) {
    throw new AppError(
      `Expected ${variableCount} bodyParamKeys but received ${normalizedBodyParamKeys.length}`,
      400,
    );
  }

  if (exampleValues && Array.isArray(exampleValues)) {
    if (exampleValues.length !== variableCount) {
      throw new AppError(
        `Expected ${variableCount} example values but received ${exampleValues.length}`,
        400,
      );
    }
  }

  // Check if variables are sequential (1, 2, 3... not 1, 3, 5)
  if (variableCount > 0) {
    const isSequential = varNumbers.every((num, idx) => num === idx + 1);
    if (!isSequential) {
      throw new AppError(
        "Variables must be sequential starting from {{1}}. Found: " +
          variables.join(", "),
        400,
      );
    }
  }
  // ===== END VARIABLE VALIDATION =====

  // Submit to Meta (if creds provided)
  let metaTemplateId = null;
  let metaStatus = "PENDING";
  let rejectionReason = null;

  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const wabaId = org?.whatsappBusinessAccountId ?? null;
    // Prefer system user token for template management.
    const accessToken =
      process.env.SYSTEM_USER_TOKEN || process.env.WHATSAPP_TOKEN || null;

    if (!accessToken) {
      logger.warn(
        "No SYSTEM_USER_TOKEN/WHATSAPP_TOKEN configured; skipping Meta template submission",
        {
          meta: { organizationId },
        },
      );
    }

    if (wabaId && accessToken) {
      const payload = buildMetaPayload({
        name: normalized,
        language,
        category,
        content,
      });
      const resp = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/message_templates`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        logger.warn("Meta template submit failed", { meta: { body: json } });
        // store as pending with rejection reason
        metaStatus = "REJECTED";
        rejectionReason = json.error?.message || "Meta submission failed";
      } else {
        metaTemplateId = json.id || null;
        metaStatus = "PENDING";
      }
    }
  } catch (err) {
    logger.error("Error submitting template to Meta", { error: err.message });
    metaStatus = "PENDING";
  }

  // Create template with variable count
  const template = await prisma.whatsAppTemplate.create({
    data: {
      organizationId,
      name: normalized,
      language,
      category,
      description,
      content,
      bodyParamsCount: variableCount, // ===== ADD VARIABLE COUNT HERE =====
      bodyParamKeys: normalizedBodyParamKeys,
      metaTemplateId,
      status: metaStatus,
      rejectionReason,
      active: metaStatus === "APPROVED",
    },
  });

  logger.info("WhatsApp template created", {
    meta: {
      templateId: template.id,
      name: normalized,
      metaTemplateId,
      variableCount, // Log variable count too
    },
  });

  res.status(201).json({ status: "success", data: template });
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
  const { description, language, category, content, bodyParamKeys } = req.body;

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

  const nextContent = content !== undefined ? content : template.content || "";
  const variableCount = extractVariableCount(nextContent);
  const normalizedBodyParamKeys = normalizeBodyParamKeys(
    bodyParamKeys !== undefined ? bodyParamKeys : template.bodyParamKeys,
  );

  if (
    normalizedBodyParamKeys.length > 0 &&
    normalizedBodyParamKeys.length !== variableCount
  ) {
    throw new AppError(
      `Expected ${variableCount} bodyParamKeys but received ${normalizedBodyParamKeys.length}`,
      400,
    );
  }

  const updatedTemplate = await prisma.whatsAppTemplate.update({
    where: { id: templateId },
    data: {
      ...(description !== undefined && { description }),
      ...(language !== undefined && { language }),
      ...(category !== undefined && { category }),
      ...(content !== undefined && { content }),
      ...(bodyParamKeys !== undefined && {
        bodyParamKeys: normalizedBodyParamKeys,
      }),
      bodyParamsCount: variableCount,
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
 * Poll Meta for pending template approvals and persist latest status
 */
export const pollWhatsAppTemplateStatus = catchAsync(async (req, res) => {
  const { organizationId } = req.user;
  const { templateId } = req.params;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  const accessToken =
    process.env.SYSTEM_USER_TOKEN ||
    org?.accessToken ||
    process.env.WHATSAPP_TOKEN ||
    null;

  if (!accessToken) {
    throw new AppError(
      "No token available to poll template status from Meta",
      400,
    );
  }

  const where = {
    organizationId,
    ...(templateId ? { id: templateId } : {}),
    ...(!templateId ? { status: "PENDING" } : {}),
  };

  const templates = await prisma.whatsAppTemplate.findMany({ where });

  if (templateId && templates.length === 0) {
    throw new AppError("Template not found", 404);
  }

  const targets = templates.filter((t) => t.metaTemplateId);
  const updates = [];

  for (const template of targets) {
    // Skip templates that have no Meta ID yet
    if (!template.metaTemplateId) {
      logger.warn("Skipping template status poll (missing metaTemplateId)", {
        meta: { templateId: template.id },
      });
      continue;
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${template.metaTemplateId}?fields=status,rejected_reason`;

      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // Always try to parse JSON, even on non-2xx responses
      let json = {};
      try {
        json = await resp.json();
      } catch {
        json = {};
      }

      if (!resp.ok) {
        logger.warn("Meta template status poll failed", {
          meta: {
            templateId: template.id,
            metaTemplateId: template.metaTemplateId,
            httpStatus: resp.status,
            metaErrorMessage: json?.error?.message,
            response: json,
          },
        });
        continue;
      }

      const mappedStatus = mapMetaStatusToTemplateStatus(json?.status);

      const rejectionReason =
        mappedStatus === "REJECTED"
          ? json?.rejected_reason || "Rejected by Meta"
          : null;

      const updated = await prisma.whatsAppTemplate.update({
        where: { id: template.id },
        data: {
          status: mappedStatus,
          rejectionReason,
          // Activate only when approved; otherwise keep inactive
          active: mappedStatus === "APPROVED",
        },
      });

      updates.push(updated);
    } catch (error) {
      logger.warn("Error polling Meta template status", {
        meta: {
          templateId: template.id,
          metaTemplateId: template.metaTemplateId,
          error: error?.message || "Unknown error",
          stack: error?.stack,
        },
      });
    }
  }

  logger.info("WhatsApp template status poll completed", {
    meta: {
      organizationId,
      requestedTemplateId: templateId || null,
      checkedTemplates: targets.length,
      updatedTemplates: updates.length,
    },
  });

  res.status(200).json({
    status: "success",
    data: {
      checked: targets.length,
      updated: updates.length,
      templates: updates,
    },
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
