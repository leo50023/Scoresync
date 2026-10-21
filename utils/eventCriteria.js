function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseEventCriteria(body = {}) {
  const criteria = body.criteria && typeof body.criteria === "object"
    ? body.criteria
    : {};
  const names = toArray(criteria.name ?? body["criteria[name]"]);
  const weights = toArray(criteria.weight ?? body["criteria[weight]"]);
  const maxScores = toArray(criteria.max ?? body["criteria[max]"]);
  const descriptions = toArray(criteria.desc ?? body["criteria[desc]"]);

  return names
    .map((name, index) => ({
      name: typeof name === "string" ? name.trim() : "",
      description: typeof descriptions[index] === "string" ? descriptions[index].trim() : "",
      weight: Number(weights[index]) || 0,
      maxScore: Number(maxScores[index]) || 100,
    }))
    .filter(criterion => criterion.name && criterion.weight > 0);
}

export function hasPeoplesChoiceCriterion(criteria = []) {
  return criteria.some(name => {
    if (typeof name !== "string") return false;
    const normalizedName = name
      .trim()
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ");
    return normalizedName === "people's choice"
      || normalizedName === "people's choice award";
  });
}
