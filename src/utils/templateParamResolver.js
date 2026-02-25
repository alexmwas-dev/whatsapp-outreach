export function getPath(obj, path) {
  if (!path || typeof path !== "string") return undefined;
  return path
    .split(".")
    .reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

export function resolveTemplateParams({
  template,
  contact,
  org,
  waNumber,
  campaign,
}) {
  const keys = Array.isArray(template?.bodyParamKeys)
    ? template.bodyParamKeys
    : [];

  const ctx = {
    contact,
    org,
    wa: waNumber,
    campaign,
  };

  return keys.map((key) => {
    const val = getPath(ctx, key);
    return val == null ? "" : String(val);
  });
}

export function extractTemplateVariableCount(template) {
  const content = template?.content || "";
  const vars = content.match(/{{\d+}}/g) || [];
  const fromContent = vars.length;
  if (fromContent > 0) return fromContent;
  if (typeof template?.bodyParamsCount === "number")
    return template.bodyParamsCount;
  return 0;
}
