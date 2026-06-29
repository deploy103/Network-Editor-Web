const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function boundingBox(locator, message) {
  const box = await locator.boundingBox();
  assert(box, message);
  return box;
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
  await page.getByRole("tab", { name: "Check Results" }).click();
  await page.locator(".activity-check-results").waitFor({ timeout: 10000 });

  const initialActivityText = await page.locator(".activity-wizard").innerText();
  assert(initialActivityText.includes("Router show version output"), "Activity Wizard must show sample CLI output assertion in Check Results");
  assert(initialActivityText.includes("Configuration register"), "Activity Wizard CLI output assertion must show expected output text");
  assert(initialActivityText.includes("HTTP destination port header") && initialActivityText.includes("HTTP Destination port=80"), "Activity Wizard must show sample HTTP PDU destination-port assertion");

  await page.getByRole("button", { name: /CLI 엔진 재검증/ }).click();
  await page.locator(".activity-engine-note", { hasText: "출력 검증 1개를 갱신" }).waitFor({ timeout: 10000 });
  const engineNote = await page.locator(".activity-engine-note").innerText();
  assert(engineNote.includes("출력 검증 1개를 갱신"), "Activity Wizard must report active CLI output revalidation");
  const revalidatedActivityText = await page.locator(".activity-wizard").innerText();
  assert(revalidatedActivityText.includes("Local CLI") && revalidatedActivityText.includes('contains "Configuration register"'), "Activity Wizard must replace CLI assertion result with active CLI engine output");

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

  await page.locator(".device-window").filter({ hasText: "Activity Wizard" }).getByTitle("창 닫기").click();

  const sampleDrawing = page.locator(".workspace-drawing.rectangle").first();
  await sampleDrawing.waitFor({ timeout: 10000 });
  await sampleDrawing.click();
  await page.locator(".drawing-selection-hud").waitFor({ timeout: 10000 });
  const drawingBeforeToolbarResize = await boundingBox(sampleDrawing, "Sample workspace drawing must have a visible bounding box before toolbar resize");
  await page.getByTitle("도형 확대").click();
  await page.waitForFunction((width) => {
    const box = document.querySelector(".workspace-drawing.rectangle")?.getBoundingClientRect();
    return Boolean(box && box.width > width + 12);
  }, drawingBeforeToolbarResize.width);
  const drawingAfterToolbarResize = await boundingBox(sampleDrawing, "Sample workspace drawing must remain visible after toolbar resize");
  assert(drawingAfterToolbarResize.width > drawingBeforeToolbarResize.width, "Drawing toolbar resize must increase the selected drawing width");

  const resizeHandle = page.locator(".workspace-drawing.rectangle .drawing-resize-handle.se").first();
  const resizeHandleBox = await boundingBox(resizeHandle, "Selected drawing must expose a southeast resize handle");
  await page.mouse.move(resizeHandleBox.x + resizeHandleBox.width / 2, resizeHandleBox.y + resizeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeHandleBox.x + resizeHandleBox.width / 2 + 48, resizeHandleBox.y + resizeHandleBox.height / 2 + 34, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(([width, height]) => {
    const box = document.querySelector(".workspace-drawing.rectangle")?.getBoundingClientRect();
    return Boolean(box && box.width > width + 18 && box.height > height + 12);
  }, [drawingAfterToolbarResize.width, drawingAfterToolbarResize.height]);
  const drawingAfterHandleResize = await boundingBox(sampleDrawing, "Sample workspace drawing must remain visible after handle resize");
  assert(drawingAfterHandleResize.width > drawingAfterToolbarResize.width && drawingAfterHandleResize.height > drawingAfterToolbarResize.height, "Drawing handle resize must increase width and height");

  await page.getByTitle("자유선 추가").click();
  await page.locator(".drawing-hud", { hasText: "자유선 추가" }).waitFor({ timeout: 10000 });
  const canvasBox = await boundingBox(page.locator(".logical-canvas"), "Logical canvas must be visible for freehand drawing");
  await page.mouse.move(canvasBox.x + 1080, canvasBox.y + 520);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 1115, canvasBox.y + 548, { steps: 4 });
  await page.mouse.move(canvasBox.x + 1160, canvasBox.y + 530, { steps: 4 });
  await page.mouse.move(canvasBox.x + 1205, canvasBox.y + 566, { steps: 4 });
  await page.mouse.up();
  await page.locator(".text-input-dialog[aria-label='자유선 레이블']").waitFor({ timeout: 10000 });
  await page.locator(".text-input-dialog[aria-label='자유선 레이블'] input").fill("Visual freehand");
  await page.locator(".text-input-dialog[aria-label='자유선 레이블']").getByRole("button", { name: "추가" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-drawing.freehand:not(.preview)").length > 0);
  const freehandShape = await page.evaluate(() => {
    const group = [...document.querySelectorAll(".workspace-drawing.freehand:not(.preview)")].at(-1);
    const box = group?.getBoundingClientRect();
    const points = group?.querySelector(".drawing-shape")?.getAttribute("points") ?? "";
    return { points: points.trim().split(/\s+/).filter(Boolean).length, width: box?.width ?? 0, height: box?.height ?? 0 };
  });
  assert(freehandShape.points >= 3 && freehandShape.width > 24 && freehandShape.height > 12, "Freehand drawing must persist as a visible multi-point workspace drawing");

  await page.locator(".device-node.router").first().click();
  await page.locator(".physical-panel").waitFor({ timeout: 10000 });
  await page.locator(".physical-port.connected").first().click();
  const physicalInspectorText = await page.locator(".physical-port-inspector").innerText();
  assert(physicalInspectorText.includes("상대 포트") && physicalInspectorText.includes("TDR"), "Physical tab must inspect selected port peer and TDR state");
  await page.locator(".physical-port-inspector").getByRole("button", { name: "케이블 분리" }).click();
  await page.locator(".physical-port-inspector").getByText("미연결").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "CLI" }).click();
  await page.getByLabel("CLI 명령").fill("show ip interface brief");
  await page.getByLabel("CLI 명령").press("Enter");
  await page.locator(".cli-terminal .terminal-output", { hasText: "IP-Address" }).waitFor({ timeout: 10000 });
  const cliOutput = await page.locator(".cli-terminal .terminal-output").innerText({ timeout: 10000 });
  assert(cliOutput.includes("Interface") && cliOutput.includes("IP-Address"), "Device CLI tab must execute live show commands in the browser");

  await page.screenshot({ path: "/tmp/network-editor-activity-visual-smoke.png", fullPage: true });
  await browser.close();
  console.log("Visual smoke tests passed");
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
