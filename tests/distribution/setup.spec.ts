import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("packaged app starts without TypeScript tools and private setup opens all roles", async ({
  page,
  request,
}) => {
  const denied = await request.get("/setup");
  expect(denied.status()).toBe(403);
  const secrets = JSON.parse(
    readFileSync("release/Party Trivia/data/access.json", "utf8"),
  );
  await page.goto(`/setup?key=${secrets.host}`);
  await expect(
    page.getByRole("heading", { name: "Your trivia test is ready" }),
  ).toBeVisible();
  for (const name of [
    "1. Open display",
    "2. Host controls",
    "3. Join as a player",
    "4. Open grader",
  ])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  const host = await page
    .getByRole("link", { name: "2. Host controls" })
    .getAttribute("href");
  await page.goto(host!);
  await expect(
    page.getByRole("button", { name: /^Start game/ }),
  ).toBeVisible();
  expect((await request.get("/questions.json")).status()).toBe(404);
  expect((await request.get("/data/access.json")).status()).toBe(404);
  await page.goto("/play");
  await page.getByLabel("Nickname").fill("Tester " + Date.now().toString().slice(-6));
  await page.getByRole("button", { name: "Let’s go" }).click();
  await expect(page.getByText("You’re in!")).toBeVisible();
});
