const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const user = {
      id: "user_visual_smoke",
      name: "Visual Smoke",
      username: "visual-smoke",
      email: "visual-smoke@example.com",
      birthDate: "2000-01-01",
      passwordHash: "visual-smoke"
    };
    localStorage.setItem("new-network-editor-users", JSON.stringify([user]));
    localStorage.setItem("new-network-editor-session", user.id);
    localStorage.setItem("new-network-editor-projects", "[]");
  });
  await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /샘플|샘플 랩/ }).first().click();
  await page.waitForURL(/\/projects\/.+/, { timeout: 15000 });
  await page.getByTitle(/Activity Wizard/).click();
  await page.locator(".activity-wizard").waitFor({ timeout: 10000 });
  await page.locator(".simulation-dock").waitFor({ timeout: 10000 });

  const layout = await page.evaluate(() => {
    const wizard = document.querySelector(".activity-wizard")?.getBoundingClientRect();
    const dock = document.querySelector(".simulation-dock")?.getBoundingClientRect();
    const workspace = document.querySelector(".packet-workspace")?.getBoundingClientRect();
    return {
      wizard: wizard ? { width: wizard.width, height: wizard.height, top: wizard.top, bottom: wizard.bottom } : null,
      dock: dock ? { width: dock.width, height: dock.height, top: dock.top, bottom: dock.bottom } : null,
      workspace: workspace ? { width: workspace.width, height: workspace.height, top: workspace.top, bottom: workspace.bottom } : null,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2
    };
  });

  assert(layout.wizard && layout.wizard.width > 520 && layout.wizard.height > 360, "Activity Wizard must render at a usable desktop size");
  assert(layout.dock && layout.dock.width > 520 && layout.dock.height > 180, "Simulation dock must render at a usable desktop size");
  assert(layout.workspace && layout.workspace.height > 320, "Workspace must remain visible behind floating panels");
  assert(!layout.horizontalOverflow, "Desktop layout must not create page-level horizontal overflow");

  await page.screenshot({ path: "/tmp/network-editor-activity-visual-smoke.png", fullPage: true });
  await browser.close();
  console.log("Visual smoke tests passed");
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
