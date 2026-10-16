import { positiveIntegerEnv } from "./config.js";

const MAX_ITEMS = positiveIntegerEnv("MAX_LINE_ITEMS", 2000);
const MAX_TEXT_LENGTH = 500;

function parseNonNegativeNumber(value) {
  if (!(typeof value === "number" || (typeof value === "string" && value.trim() !== ""))) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function validateDocument(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return "Each document must be a JSON object";
  }
  if (!["invoice", "purchase_order"].includes(doc.type)) {
    return "type must be 'invoice' or 'purchase_order'";
  }

  for (const field of ["number", "date", "customer", "vendor"]) {
    if (doc[field] !== undefined && (typeof doc[field] !== "string" || doc[field].length > MAX_TEXT_LENGTH)) {
      return `${field} must be a string of at most ${MAX_TEXT_LENGTH} characters`;
    }
  }

  if (!Array.isArray(doc.items)) return "items must be an array";
  if (doc.items.length > MAX_ITEMS) return `items cannot contain more than ${MAX_ITEMS} line items`;

  let total = 0;
  for (const [i, item] of doc.items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `items[${i}] must be an object`;
    }
    if (typeof item.description !== "string" || item.description.trim() === "" || item.description.length > MAX_TEXT_LENGTH) {
      return `items[${i}].description must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`;
    }

    const quantity = parseNonNegativeNumber(item.quantity);
    if (quantity === null) return `items[${i}].quantity must be a finite non-negative number`;
    const unitPrice = parseNonNegativeNumber(item.unitPrice);
    if (unitPrice === null) return `items[${i}].unitPrice must be a finite non-negative number`;

    const lineTotal = quantity * unitPrice;
    total += lineTotal;
    if (!Number.isFinite(lineTotal) || !Number.isFinite(total)) {
      return `items[${i}] makes the document total too large`;
    }
  }

  return null;
}
