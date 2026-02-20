import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";

type FlowIds = {
  brandId: string;
  campaignId?: string;
};

const brandsFile = path.join(process.cwd(), "data", "brands.v2.json");
const campaignsFile = path.join(process.cwd(), "data", "campaigns.v2.json");
const outreachFile = path.join(process.cwd(), "data", "outreach.v1.json");

async function resetDataFiles() {
  await fs.rm(brandsFile, { force: true });
  await fs.rm(campaignsFile, { force: true });
  await fs.rm(outreachFile, { force: true });
}

function parseIdsFromUrl(url: string): FlowIds {
  const brandMatch = url.match(/\/brands\/(brand_[^/?#]+)/);
  const campaignMatch = url.match(/\/campaigns\/([^/?#]+)/);
  return {
    brandId: brandMatch?.[1] ?? "",
    campaignId: campaignMatch?.[1],
  };
}

async function createBrand(page: import("@playwright/test").Page, suffix: string) {
  await page.goto("/brands/new");

  await page.getByLabel("Website").fill(`https://example-${suffix}.com`);
  await page.getByLabel("Name").fill(`Brand ${suffix}`);
  await page.getByLabel("Tone").fill("Concise, technical");
  await page.getByLabel("Proof / Notes").fill("Used by high-intent teams.");
  await page.getByRole("button", { name: "Save Brand" }).click();

  await expect(page).toHaveURL(/\/brands\/brand_[^/]+$/);
  const ids = parseIdsFromUrl(page.url());
  expect(ids.brandId).not.toBe("");
  return ids.brandId;
}

async function createCampaign(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "New Campaign" });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page).toHaveURL(/\/brands\/[^/]+\/campaigns\/[^/]+\/build$/);
  const ids = parseIdsFromUrl(page.url());
  expect(ids.campaignId).toBeTruthy();
  return ids;
}

test.beforeEach(async ({ page, context }) => {
  await resetDataFiles();
  await context.clearCookies();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("new user can onboard and land on campaign build", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Create Brand/i }).click();

  const brandId = await createBrand(page, "onboard");
  expect(brandId).not.toBe("");

  const ids = await createCampaign(page);
  expect(ids.brandId).toBe(brandId);

  await expect(page.getByRole("heading", { name: "Campaign Build" })).toBeVisible();
  await expect(page.getByText("Build your campaign in one place", { exact: false })).toBeVisible();
});

test("user can complete build-run journey and resume", async ({ page }) => {
  const brandId = await createBrand(page, "complete");
  const { campaignId } = await createCampaign(page);
  expect(campaignId).toBeTruthy();

  await page.getByLabel("Goal").fill("Book 10 qualified demos");
  await page.getByLabel("Constraints").fill("Max 60 outbound/day, no generic copy");
  await page.getByRole("button", { name: "Add Angle" }).click();
  await page.getByLabel("Angle Title").first().fill("Founder wedge");
  await page.getByLabel("Target Segment").first().fill("B2B SaaS founders, 10-100 employees");
  await page.getByRole("button", { name: "Add Variant" }).click();
  await page.getByLabel("Variant Name").first().fill("Founder wedge / fast hook");
  await page.getByRole("button", { name: "Save Build" }).click();
  await page.getByRole("link", { name: "Go to Run" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${brandId}/campaigns/${campaignId}/run/overview$`));

  await page.goto(`/brands/${brandId}/campaigns`);
  await page.getByRole("link", { name: "Open Run" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/brands/${brandId}/campaigns/${campaignId}/run/overview$`));
});

test("user can navigate campaign and ops modules without losing brand context", async ({ page }) => {
  const brandId = await createBrand(page, "ops");
  const { campaignId } = await createCampaign(page);
  expect(campaignId).toBeTruthy();

  await page.locator("aside").getByRole("link", { name: /^Network$/ }).click();
  await expect(page).toHaveURL(`/brands/${brandId}/network`);
  await expect(page.getByRole("heading", { name: "Network" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Go to Campaigns" }).click();
  await expect(page).toHaveURL(`/brands/${brandId}/campaigns`);

  await page.getByRole("link", { name: /^Open Build$/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/brands/${brandId}/campaigns/${campaignId}/build$`));

  await page.locator("aside").getByRole("link", { name: /^Inbox$/ }).click();
  await expect(page).toHaveURL(`/brands/${brandId}/inbox`);
});

test("legacy removed route returns not found behavior", async ({ page }) => {
  const response = await page.goto("/projects", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/not found|404/i)).toBeVisible();
});

test.describe("mobile core journey", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile user can create brand and reach build workspace", async ({ page }) => {
    const brandId = await createBrand(page, "mobile");
    const { campaignId } = await createCampaign(page);

    await page.getByLabel("Goal").fill("Validate mobile execution flow");
    await page.getByLabel("Constraints").fill("Keep interactions short and deterministic");

    await expect(page).toHaveURL(new RegExp(`/brands/${brandId}/campaigns/${campaignId}/build$`));
    await expect(page.getByRole("heading", { name: "Campaign Build" })).toBeVisible();
  });
});

test("old step routes return not found behavior", async ({ page }) => {
  const brandId = await createBrand(page, "legacy");
  const { campaignId } = await createCampaign(page);
  expect(campaignId).toBeTruthy();

  await page.goto(`/brands/${brandId}/campaigns/${campaignId}/objective`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/404|not found/i)).toBeVisible();

  await page.goto(`/brands/${brandId}/campaigns/${campaignId}/hypotheses`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/404|not found/i)).toBeVisible();
});
