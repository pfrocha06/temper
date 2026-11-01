// Browser checks with Playwright. Not installed by default: to use it, run
//   npm install -D @playwright/test && npx playwright install chromium
// here, and give the project `--holdouts-setup "npm install"`.
export async function withPage(url, fn) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url, { waitUntil: "networkidle" });
    return await fn(page, errors);
  } finally {
    await browser.close();
  }
}
