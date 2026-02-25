export function normalizeTemplateName(name) {
  if (!name) return "";
  // Lowercase, replace spaces and non-alphanum with underscores, remove duplicate underscores
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_");
}

export function buildMetaPayload({
  name,
  language,
  category,
  content,
  exampleValues = null, // Accept optional examples from frontend
}) {
  // Find all {{number}} variables
  const variableMatches = content.match(/{{\d+}}/g) || [];
  const variableCount = variableMatches.length;

  let example = undefined;

  if (variableCount > 0) {
    // Use provided examples or generate defaults
    const examples =
      exampleValues &&
      Array.isArray(exampleValues) &&
      exampleValues.length === variableCount
        ? exampleValues
        : Array.from({ length: variableCount }, (_, i) => {
            // Generate meaningful defaults based on position
            const defaults = [
              "John Doe", // {{1}} - typically name
              "Acme Corporation", // {{2}} - typically company/product
              "123456", // {{3}} - typically code/number
              "January 15, 2024", // {{4}} - typically date
              "$99.99", // {{5}} - typically amount
            ];
            return defaults[i] || `example${i + 1}`;
          });

    example = {
      body_text: [examples],
    };
  }

  return {
    name,
    language,
    category,
    components: [
      {
        type: "BODY",
        text: content,
        ...(example && { example }),
      },
    ],
  };
}
