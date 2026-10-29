#!/usr/bin/env node
/**
 * Smoke test for the Micro-SaaS Factory API.
 *
 * Requires the dev/prod server to be running (default http://localhost:3000).
 * Exercises all three factory endpoints and validates the responses.
 *
 *   BASE_URL=http://localhost:3000 npm run smoke
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;

function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  console.log("[1] GET /api/factory/ideas");
  const ideasRes = await fetch(`${BASE}/api/factory/ideas`);
  const ideas = await ideasRes.json();
  check("status 200", ideasRes.status === 200, `got ${ideasRes.status}`);
  check("ok=true", ideas.ok === true);
  check("100 ideas", ideas.total === 100, `got ${ideas.total}`);
  check(
    "first idea is Price Per Ounce Calculator",
    ideas.ideas?.[0]?.slug === "price-per-ounce-calculator",
    `got ${ideas.ideas?.[0]?.slug}`
  );

  console.log("\n[2] GET /api/factory/ideas?limit=5");
  const limited = await (await fetch(`${BASE}/api/factory/ideas?limit=5`)).json();
  check("limit respected", limited.count === 5 && limited.total === 100);

  console.log("\n[3] GET /api/factory/list (baseline)");
  const listBefore = await (await fetch(`${BASE}/api/factory/list`)).json();
  check("status ok", listBefore.ok === true);
  check("array", Array.isArray(listBefore.products));
  const beforeCount = listBefore.count;

  console.log("\n[4] POST /api/factory/create (smoke product)");
  const slug = `smoke-test-product-${Date.now()}`;
  const createRes = await fetch(`${BASE}/api/factory/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Test Product",
      slug,
      problem: "Validating the factory end to end",
      target: "CI pipelines",
      price: "$1 one-time",
    }),
  });
  const created = await createRes.json();
  check("status 201", createRes.status === 201, `got ${createRes.status} ${JSON.stringify(created)}`);
  check("ok=true", created.ok === true);
  check("slug echoed", created.product?.slug === slug, `got ${created.product?.slug}`);
  check("files copied", (created.product?.files ?? 0) > 10, `got ${created.product?.files}`);

  console.log("\n[5] POST /api/factory/create (duplicate must fail)");
  const dupRes = await fetch(`${BASE}/api/factory/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Test Product",
      slug,
      problem: "dup",
      target: "CI",
      price: "$1",
    }),
  });
  const dup = await dupRes.json();
  check("status 409", dupRes.status === 409, `got ${dupRes.status}`);
  check("error mentions exists", /already exists/i.test(dup.error ?? ""));

  console.log("\n[6] POST /api/factory/create (validation)");
  const badRes = await fetch(`${BASE}/api/factory/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Only Name" }),
  });
  check("status 400", badRes.status === 400, `got ${badRes.status}`);

  console.log("\n[7] GET /api/factory/list (after create)");
  const listAfter = await (await fetch(`${BASE}/api/factory/list`)).json();
  check("count increased by 1", listAfter.count === beforeCount + 1, `${beforeCount} -> ${listAfter.count}`);
  check(
    "smoke product present",
    listAfter.products.some((p) => p.slug === slug)
  );

  console.log("\n[8] GET / (dashboard)");
  const homeRes = await fetch(`${BASE}/`);
  const homeHtml = await homeRes.text();
  check("status 200", homeRes.status === 200, `got ${homeRes.status}`);
  check("renders title", homeHtml.includes("Micro-SaaS Factory"));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
