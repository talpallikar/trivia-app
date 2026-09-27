import { test, expect } from "@playwright/test";
test("four screens complete a game with refresh, draft restore, grading and regrade", async ({
  browser,
}) => {
  const display = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const host = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const player = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const grader = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const errors: string[] = [];
  for (const page of [display, host, player, grader])
    page.on("pageerror", (e) => errors.push(e.message));
  await Promise.all([
    display.goto("/display"),
    host.goto("/host?key=browser-host"),
    player.goto("/play"),
    grader.goto("/grade?key=browser-grader"),
  ]);
  await player.getByLabel("Nickname").fill("Ada");
  await player.getByRole("button", { name: "Let’s go" }).click();
  await expect(player.getByText("You’re in!")).toBeVisible();
  await expect(display.getByRole("img")).toBeVisible();
  await display.screenshot({ path: "test-results/lobby.png" });
  await host
    .getByRole("button", { name: "Start game (1)", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Open question", exact: true })
    .click();
  await expect(
    display.getByRole("heading", {
      name: "Which planet has the most spectacular rings?",
    }),
  ).toBeVisible();
  await host.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(player.getByText("Paused — hold on.")).toBeVisible();
  await host.getByRole("button", { name: "Resume", exact: true }).click();
  await player.getByRole("button", { name: /Saturn/ }).click();
  await expect(
    player.getByRole("heading", { name: "Correct!", exact: true }),
  ).toBeVisible();
  await player.reload();
  await expect(
    player.getByRole("heading", { name: "Correct!", exact: true }),
  ).toBeVisible();
  await host
    .getByRole("button", { name: "Show leaderboard", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await player.getByRole("button", { name: /True/ }).click();
  await expect(
    player.getByRole("heading", { name: "Correct!", exact: true }),
  ).toBeVisible();
  await host
    .getByRole("button", { name: "Show leaderboard", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Open question", exact: true })
    .click();
  await player.getByLabel("Your answer", { exact: true }).fill("London");
  await player.reload();
  await expect(player.getByLabel("Your answer", { exact: true })).toHaveValue(
    "London",
  );
  await player.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    display.getByRole("heading", { name: "Judging in progress…" }),
  ).toBeVisible();
  await expect(display.getByText("London", { exact: true })).toHaveCount(0);
  await expect(grader.getByText("London", { exact: true })).toBeVisible();
  await grader.getByRole("button", { name: "✓ Correct", exact: true }).click();
  await grader.reload();
  await expect(
    grader.getByRole("button", { name: "✓ Correct", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await grader
    .getByRole("button", { name: "Submit & reveal", exact: true })
    .click();
  await expect(
    player.getByRole("heading", { name: "Correct!", exact: true }),
  ).toBeVisible();
  await grader.getByRole("button", { name: "✗ Wrong", exact: true }).click();
  await expect(
    player.getByRole("heading", { name: "Not quite", exact: true }),
  ).toBeVisible();
  await host
    .getByRole("button", { name: "Show leaderboard", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await player
    .getByLabel("Your answer", { exact: true })
    .fill("Sardine sundae: a scoop of the sea.");
  await player.getByRole("button", { name: "Send", exact: true }).click();
  await grader.getByRole("button", { name: "½ Partial", exact: true }).click();
  await grader
    .getByRole("button", { name: "Feature on projector", exact: true })
    .click();
  await expect(display.getByText(/Sardine sundae/)).toHaveCount(0);
  await grader
    .getByRole("button", { name: "Submit & reveal", exact: true })
    .click();
  await expect(display.getByText(/Sardine sundae/)).toBeVisible();
  await expect(
    player.getByRole("heading", { name: "Partly right", exact: true }),
  ).toBeVisible();
  await display.screenshot({ path: "test-results/reveal.png" });
  await grader.screenshot({ path: "test-results/grader.png" });
  await host.screenshot({ path: "test-results/host.png" });
  await player.screenshot({ path: "test-results/player.png" });
  await host
    .getByRole("button", { name: "Show leaderboard", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Final results", exact: true })
    .click();
  await expect(
    player.getByRole("heading", { name: "Champion!", exact: true }),
  ).toBeVisible();
  await expect(
    display.getByRole("heading", { name: "Final results", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  for (const page of [display, host, player, grader]) await page.close();
});
