// Input sanitization helpers — no external package required

/**
 * Strip HTML tags, trim whitespace, enforce max length.
 * Use for all user-supplied text fields (name, title, description, etc.)
 */
export function sanitizeText(value, maxLength = 255) {
  if (!value || typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")        // strip HTML tags
    .replace(/[<>"'`]/g, "")        // strip remaining dangerous chars
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate and normalise an email address.
 * Returns lowercase trimmed email or empty string if invalid.
 */
export function sanitizeEmail(value) {
  if (!value || typeof value !== "string") return "";
  const email = value.trim().toLowerCase().slice(0, 254);
  // RFC 5322 simplified check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/**
 * Sanitize a role string — only allow known values.
 */
export function sanitizeRole(value, allowed = ["admin", "judge", "encoder", "organizer", "tabulator"]) {
  if (!value || typeof value !== "string") return "";
  return allowed.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : "";
}
