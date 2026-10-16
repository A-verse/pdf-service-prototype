import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "../src/validation.js";

const validInvoice = () => ({
  type: "invoice",
  number: "INV-1",
  date: "2026-10-14",
  customer: "Example Co",
  items: [{ description: "Part", quantity: 2, unitPrice: 5 }]
});

test("accepts a valid invoice", () => assert.equal(validateDocument(validInvoice()), null));
test("accepts a purchase order with vendor", () => assert.equal(validateDocument({
  type: "purchase_order", vendor: "Supplier", items: []
}), null));
test("rejects null and array payloads", () => {
  assert.match(validateDocument(null), /JSON object/);
  assert.match(validateDocument([]), /JSON object/);
});
test("rejects unsupported document type", () => assert.match(validateDocument({ type: "quote", items: [] }), /type must/));
test("rejects missing item arrays", () => assert.match(validateDocument({ type: "invoice" }), /items must be an array/));
test("rejects negative quantity", () => assert.match(validateDocument({
  type: "invoice", items: [{ description: "Part", quantity: -1, unitPrice: 5 }]
}), /quantity/));
test("rejects blank numeric strings", () => assert.match(validateDocument({
  type: "invoice", items: [{ description: "Part", quantity: " ", unitPrice: 5 }]
}), /quantity/));
test("rejects NaN and infinite numeric values", () => {
  assert.match(validateDocument({ type: "invoice", items: [{ description: "Part", quantity: "NaN", unitPrice: 5 }] }), /quantity/);
  assert.match(validateDocument({ type: "invoice", items: [{ description: "Part", quantity: 1, unitPrice: Infinity }] }), /unitPrice/);
});
test("rejects malformed line items", () => assert.match(validateDocument({
  type: "invoice", items: [null]
}), /must be an object/));
test("rejects oversized descriptions", () => assert.match(validateDocument({
  type: "invoice", items: [{ description: "x".repeat(501), quantity: 1, unitPrice: 1 }]
}), /description/));
test("rejects unsafe overflowing totals", () => assert.match(validateDocument({
  type: "invoice", items: [{ description: "Part", quantity: 1e308, unitPrice: 1e308 }]
}), /total too large/));
