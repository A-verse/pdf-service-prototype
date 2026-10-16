import test from "node:test";
import assert from "node:assert/strict";
import { renderDocumentHtml } from "../src/template.js";

test("escapes user-provided text before placing it in HTML", () => {
  const html = renderDocumentHtml({
    type: "invoice",
    number: '<img src=x onerror="alert(1)">',
    items: [{ description: "Bolt & <washer>", quantity: 1, unitPrice: 2 }]
  });
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("Bolt &amp; &lt;washer&gt;"));
  assert.ok(!html.includes('<img src=x'));
});

test("builds a long document table without dropping line items", () => {
  const items = Array.from({ length: 600 }, (_, index) => ({
    description: `Part ${index + 1}`,
    quantity: 1,
    unitPrice: 2
  }));
  const html = renderDocumentHtml({ type: "purchase_order", items });
  assert.ok(html.includes("Part 1"));
  assert.ok(html.includes("Part 600"));
  assert.equal((html.match(/<tr><td>/g) || []).length, 600);
});
