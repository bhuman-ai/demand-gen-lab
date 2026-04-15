import { access, mkdir } from "fs/promises";
import * as path from "path";
import type { BrowserContext, Page } from "playwright";
import type { SocialDiscoveryPromotionPurchase } from "@/lib/social-discovery-types";

type BuyShazamUiPurchaseParams = {
  productUrl: string;
  commentUrl: string;
  screenshotDir?: string;
};

type BuyShazamUiConfig = {
  userDataDir: string;
  chromeProfileDirectory: string;
  browserChannel: string;
  executablePath: string;
  screenshotDir: string;
  headless: boolean;
  username: string;
  password: string;
};

function parseBoolean(value: string, fallback: boolean) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensureDisplayEnv() {
  if (String(process.env.DISPLAY ?? "").trim()) return;
  const configured = String(process.env.BUY_SHAZAM_UI_DISPLAY ?? process.env.GMAIL_UI_DISPLAY ?? "").trim();
  process.env.DISPLAY = configured || ":99";
}

function resolveExecutablePath() {
  return String(
    process.env.BUY_SHAZAM_UI_EXECUTABLE_PATH ??
      process.env.GMAIL_UI_EXECUTABLE_PATH ??
      process.env.CHROME_EXECUTABLE_PATH ??
      ""
  ).trim();
}

function resolveBuyShazamUiConfig(screenshotDir?: string): BuyShazamUiConfig {
  const userDataDir = path.resolve(
    String(process.env.BUY_SHAZAM_UI_USER_DATA_DIR ?? "").trim() || path.join(process.cwd(), "data", "buyshazam-ui-profile")
  );
  return {
    userDataDir,
    chromeProfileDirectory: String(process.env.BUY_SHAZAM_UI_PROFILE_DIRECTORY ?? "").trim(),
    browserChannel: String(process.env.BUY_SHAZAM_UI_BROWSER_CHANNEL ?? "chrome").trim() || "chrome",
    executablePath: resolveExecutablePath(),
    screenshotDir:
      screenshotDir?.trim() || path.join(process.cwd(), "output", "playwright", "buyshazam-ui-purchase"),
    headless: parseBoolean(String(process.env.BUY_SHAZAM_UI_HEADLESS ?? ""), false),
    username: String(process.env.BUY_SHAZAM_UI_USERNAME ?? "").trim(),
    password: String(process.env.BUY_SHAZAM_UI_PASSWORD ?? "").trim(),
  };
}

function baseResult(input: BuyShazamUiPurchaseParams): SocialDiscoveryPromotionPurchase {
  return {
    provider: "buyshazam",
    mode: "wallet",
    status: "failed",
    productUrl: input.productUrl.trim(),
    cartUrl: "",
    checkoutUrl: "",
    sourceCommentUrl: input.commentUrl.trim(),
    addedToCart: false,
    walletOptionLabel: "",
    walletBalance: "",
    missingFields: [],
    orderId: "",
    orderUrl: "",
    message: "",
    screenshotPath: "",
    attemptedAt: new Date().toISOString(),
  };
}

function productOriginUrl(productUrl: string) {
  try {
    const parsed = new URL(productUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "https://buyshazam.com";
  }
}

function buildSiteUrl(productUrl: string, pathname: string) {
  return new URL(pathname, productOriginUrl(productUrl)).toString();
}

async function waitForSettledPage(page: Page, timeoutMs = 12000) {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5000) }).catch(() => {});
  await page.waitForTimeout(1200).catch(() => {});
}

async function fillRequiredCommentUrl(page: Page, commentUrl: string) {
  const selectors = [
    'input[name="tmcp_textfield_1"]',
    'input[id^="tmcp_textfield_"][required]',
    "form.cart input[type='url'][required]",
    "form.cart input[type='text'][required]",
  ];

  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(commentUrl);
      return true;
    }
  }
  return false;
}

async function selectIfPresent(page: Page, selector: string, preferredValue: string) {
  const field = page.locator(selector).first();
  if (!(await field.isVisible().catch(() => false))) return;
  await field.selectOption({ value: preferredValue }).catch(async () => {
    await field.selectOption({ label: preferredValue }).catch(() => {});
  });
}

async function verifyCartContainsComment(page: Page, commentUrl: string) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const cookies = await page.context().cookies().catch(() => []);
  const hasCartCookie = cookies.some(
    (cookie: { name?: string; value?: string }) =>
      cookie.name === "woocommerce_items_in_cart" && String(cookie.value ?? "").trim() !== "0"
  );
  return bodyText.includes(commentUrl) || hasCartCookie;
}

async function cartItemCount(page: Page) {
  return page
    .locator(".woocommerce-cart-form__cart-item, .shop_table.cart tbody tr.cart_item")
    .count()
    .catch(() => 0);
}

async function clearExistingCart(page: Page, cartUrl: string) {
  let removedCount = 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSettledPage(page, 12000);

    const currentItemCount = await cartItemCount(page);
    if (!currentItemCount) {
      return { cleared: true, removedCount };
    }

    const removeLinks = await page
      .locator('a.remove[href], .product-remove a[href*="remove_item"]')
      .evaluateAll((elements) =>
        elements
          .map((element) => (element instanceof HTMLAnchorElement ? element.href : ""))
          .filter((href) => Boolean(href))
      )
      .catch(() => [] as string[]);

    if (!removeLinks.length) {
      return { cleared: false, removedCount };
    }

    for (const href of removeLinks) {
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await waitForSettledPage(page, 10000);
      removedCount += 1;
    }
  }

  await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await waitForSettledPage(page, 12000);
  return { cleared: (await cartItemCount(page)) === 0, removedCount };
}

async function inspectCheckout(page: Page) {
  return page.evaluate(() => {
    const paymentCandidates = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="payment_method"]')).map(
      (input) => {
        const explicit = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
        const wrapped = input.closest("label");
        const label =
          explicit?.textContent?.replace(/\s+/g, " ").trim() ||
          wrapped?.textContent?.replace(/\s+/g, " ").trim() ||
          input.getAttribute("placeholder") ||
          input.getAttribute("name") ||
          input.id ||
          "";
        return {
          id: input.id,
          name: input.name,
          value: input.value,
          checked: input.checked,
          label,
        };
      }
    );

    const walletToggleCandidates = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')
    )
      .map((input) => {
        const explicit = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
        const wrapped = input.closest("label");
        const label =
          explicit?.textContent?.replace(/\s+/g, " ").trim() ||
          wrapped?.textContent?.replace(/\s+/g, " ").trim() ||
          input.getAttribute("placeholder") ||
          input.getAttribute("name") ||
          input.id ||
          "";
        return {
          id: input.id,
          name: input.name,
          value: input.value,
          checked: input.checked,
          label,
        };
      })
      .filter((entry) => /wallet/i.test(`${entry.id} ${entry.name} ${entry.value} ${entry.label}`));

    const missingFields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("form.checkout input, form.checkout select, form.checkout textarea")
    )
      .filter((field) => {
        if ((field as HTMLInputElement).type === "hidden") return false;
        if (field.disabled) return false;
        if (field.getAttribute("aria-hidden") === "true") return false;
        const style = window.getComputedStyle(field);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (!(field.offsetParent || style.position === "fixed")) return false;
        const input = field as HTMLInputElement;
        if (input.type === "radio" || input.type === "checkbox") return false;
        const required =
          field.hasAttribute("required") ||
          field.getAttribute("aria-required") === "true" ||
          field.closest(".validate-required");
        if (!required) return false;
        return !String((field as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value ?? "").trim();
      })
      .map((field) => {
        const explicit = field.id ? document.querySelector(`label[for="${field.id}"]`) : null;
        const wrapped = field.closest("label");
        return (
          explicit?.textContent?.replace(/\s+/g, " ").trim() ||
          wrapped?.textContent?.replace(/\s+/g, " ").trim() ||
          field.getAttribute("placeholder") ||
          field.getAttribute("name") ||
          field.id ||
          ""
        );
      })
      .filter(Boolean);

    const orderText = (document.body?.textContent || "").replace(/\s+/g, " ");
    const walletBalanceMatch = orderText.match(/wallet[^$€£]*([$€£]\s?\d[\d.,]*)/i);

    return {
      paymentCandidates,
      walletToggleCandidates,
      missingFields,
      walletBalance: walletBalanceMatch?.[1]?.trim() || "",
      bodyText: orderText,
    };
  });
}

async function clickWalletControl(page: Page, entry: { id: string; label: string }) {
  if (entry.id) {
    const label = page.locator(`label[for="${entry.id}"]`).first();
    if (await label.isVisible().catch(() => false)) {
      await label.click().catch(() => {});
      return true;
    }
    const input = page.locator(`#${entry.id}`).first();
    if (await input.isVisible().catch(() => false)) {
      await input.check().catch(async () => {
        await input.click().catch(() => {});
      });
      return true;
    }
  }
  const textTarget = page.getByText(/wallet/i).first();
  if (await textTarget.isVisible().catch(() => false)) {
    await textTarget.click().catch(() => {});
    return true;
  }
  return false;
}

async function detectAuthenticatedWalletSession(page: Page, walletUrl: string) {
  await page.goto(walletUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForSettledPage(page);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/login \/ register|register|sign in|lost your password/i.test(bodyText)) {
    return false;
  }
  return /wallet|balance|transactions|top up|withdraw/i.test(bodyText);
}

async function loginToBuyShazamWallet(page: Page, walletUrl: string, config: Pick<BuyShazamUiConfig, "username" | "password">) {
  await page.goto(walletUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForSettledPage(page);

  const initialBody = await page.locator("body").innerText().catch(() => "");
  if (!/login \/ register|register|sign in|username or email/i.test(initialBody)) {
    return /wallet|balance|transactions|top up|withdraw/i.test(initialBody);
  }
  if (!config.username || !config.password) {
    return false;
  }

  const username = page.locator('#username, input[name="username"]').first();
  const password = page.locator('#password, input[name="password"]').first();
  if (!(await username.isVisible().catch(() => false)) || !(await password.isVisible().catch(() => false))) {
    return false;
  }

  await username.fill(config.username);
  await password.fill(config.password);

  const remember = page.locator('input[name="rememberme"], #rememberme').first();
  if (await remember.isVisible().catch(() => false)) {
    await remember.check().catch(() => {});
  }

  const submit = page
    .locator(
      'button[name="login"], button.woocommerce-button[name="login"], form.login button[type="submit"], form.woocommerce-form-login button[type="submit"]'
    )
    .first();
  if (!(await submit.isVisible().catch(() => false))) {
    return false;
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {}),
    submit.click(),
  ]);
  await waitForSettledPage(page, 12000);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/incorrect|error|invalid|unknown email|please enter/i.test(bodyText) && /login|password/i.test(bodyText)) {
    return false;
  }
  return /wallet|balance|transactions|top up|withdraw/i.test(bodyText) && !/login \/ register|sign in/i.test(bodyText);
}

async function ensureAuthenticatedWalletSession(
  page: Page,
  walletUrl: string,
  config: Pick<BuyShazamUiConfig, "username" | "password">
) {
  if (await detectAuthenticatedWalletSession(page, walletUrl)) {
    return { authenticated: true, attemptedLogin: false };
  }
  const authenticated = await loginToBuyShazamWallet(page, walletUrl, config);
  return { authenticated, attemptedLogin: true };
}

function extractOrderId(orderUrl: string, bodyText: string) {
  const urlMatch = orderUrl.match(/order-received\/(\d+)/i) || orderUrl.match(/order-pay\/(\d+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const bodyMatch = bodyText.match(/order number[:#\s]+(\d+)/i);
  return bodyMatch?.[1] ?? "";
}

async function captureScreenshot(page: Page, screenshotDir: string, prefix: string) {
  const filename = `${prefix}-${Date.now().toString(36)}.png`;
  const screenshotPath = path.join(screenshotDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  return screenshotPath;
}

export function getBuyShazamUiRuntimeConfig(overrides: { screenshotDir?: string } = {}) {
  return resolveBuyShazamUiConfig(overrides.screenshotDir);
}

export async function runBuyShazamCommentLikesPurchase(
  input: BuyShazamUiPurchaseParams
): Promise<SocialDiscoveryPromotionPurchase> {
  const result = baseResult(input);
  result.cartUrl = buildSiteUrl(input.productUrl, "/cart/");
  result.checkoutUrl = buildSiteUrl(input.productUrl, "/checkout/");
  const walletUrl = buildSiteUrl(input.productUrl, "/my-account/woo-wallet/");

  if (process.env.VERCEL) {
    result.status = "requires_configuration";
    result.message = "BuyShazam checkout automation only runs in the local operator runtime.";
    return result;
  }
  if (!input.productUrl.trim()) {
    result.message = "BuyShazam product URL is missing.";
    return result;
  }
  if (!input.commentUrl.trim()) {
    result.message = "Comment URL is missing, so the BuyShazam product form cannot be filled.";
    return result;
  }

  const config = resolveBuyShazamUiConfig(input.screenshotDir);
  ensureDisplayEnv();
  await mkdir(config.userDataDir, { recursive: true });
  await mkdir(config.screenshotDir, { recursive: true });

  const { chromium } = await import("playwright");
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const launchOptions: Record<string, unknown> = {
      headless: config.headless,
      viewport: { width: 1440, height: 980 },
      args: config.chromeProfileDirectory ? [`--profile-directory=${config.chromeProfileDirectory}`] : [],
    };
    if (config.executablePath) {
      launchOptions.executablePath = config.executablePath;
    } else {
      launchOptions.channel = config.browserChannel;
    }

    const launchedContext = await chromium.launchPersistentContext(config.userDataDir, launchOptions);
    context = launchedContext;
    page = launchedContext.pages()[0] ?? (await launchedContext.newPage());

    const walletSession = await ensureAuthenticatedWalletSession(page, walletUrl, config);
    if (!walletSession.authenticated) {
      result.status = "requires_login";
      result.message =
        walletSession.attemptedLogin && config.username && config.password
          ? "BuyShazam auto-login failed and the wallet session could not be restored."
          : "BuyShazam wallet checkout requires a logged-in account session in the automation profile.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-login-required");
      return result;
    }

    const clearedCart = await clearExistingCart(page, result.cartUrl);
    if (!clearedCart.cleared) {
      result.message = "BuyShazam cart could not be cleared before starting a new checkout.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-cart-clear-failed");
      return result;
    }

    await page.goto(input.productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSettledPage(page);

    const commentFilled = await fillRequiredCommentUrl(page, input.commentUrl.trim());
    if (!commentFilled) {
      result.message = "BuyShazam product form did not expose a required comment-link field.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-missing-comment-field");
      return result;
    }

    await selectIfPresent(page, 'select[name="tmcp_select_0"]', "Comment Likes_0");
    await selectIfPresent(page, 'select[name="tmcp_select_0_quantity"]', "20");

    const quantityInput = page.locator('input[name="quantity"]').first();
    if (await quantityInput.isVisible().catch(() => false)) {
      await quantityInput.fill("1").catch(() => {});
    }

    const addToCart = page.locator('button.single_add_to_cart_button, button[name="add-to-cart"]').first();
    if (!(await addToCart.isVisible().catch(() => false))) {
      result.message = "BuyShazam add-to-cart button was not available.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-missing-add-to-cart");
      return result;
    }

    await addToCart.click();
    await waitForSettledPage(page, 15000);

    await page.goto(result.cartUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSettledPage(page);

    result.addedToCart = await verifyCartContainsComment(page, input.commentUrl.trim());
    if (!result.addedToCart) {
      result.message = "BuyShazam cart did not reflect the comment URL after add-to-cart.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-cart-verify-failed");
      return result;
    }

    await page.goto(result.checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSettledPage(page, 15000);

    const checkout = await inspectCheckout(page);
    result.walletBalance = checkout.walletBalance;

    const walletPaymentCandidate = checkout.paymentCandidates.find((entry: { id: string; label: string; value: string }) =>
      /wallet/i.test(`${entry.id} ${entry.label} ${entry.value}`)
    );
    const walletToggleCandidate = checkout.walletToggleCandidates.find(
      (entry: { id: string; label: string; value: string }) => /wallet/i.test(`${entry.id} ${entry.label} ${entry.value}`)
    );

    if (walletPaymentCandidate) {
      result.walletOptionLabel = walletPaymentCandidate.label;
      await clickWalletControl(page, walletPaymentCandidate);
      await waitForSettledPage(page, 6000);
    } else if (walletToggleCandidate) {
      result.walletOptionLabel = walletToggleCandidate.label;
      await clickWalletControl(page, walletToggleCandidate);
      await waitForSettledPage(page, 6000);
    } else {
      const walletSessionReady = await detectAuthenticatedWalletSession(
        page,
        walletUrl
      );
      result.status = walletSessionReady ? "wallet_unavailable" : "requires_login";
      result.message = walletSessionReady
        ? "BuyShazam account is logged in, but no wallet payment control was available on checkout."
        : "BuyShazam wallet checkout requires a logged-in account session in the automation profile.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-wallet-unavailable");
      return result;
    }

    const postWalletCheckout = await inspectCheckout(page);
    result.walletBalance = postWalletCheckout.walletBalance || result.walletBalance;
    result.missingFields = postWalletCheckout.missingFields;
    if (result.missingFields.length) {
      result.status = "checkout_requires_input";
      result.message = `BuyShazam checkout still requires fields: ${result.missingFields.join(", ")}`;
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-checkout-missing-fields");
      return result;
    }

    const placeOrder = page.locator('#place_order, button[name="woocommerce_checkout_place_order"]').first();
    if (!(await placeOrder.isVisible().catch(() => false))) {
      result.status = "wallet_unavailable";
      result.message = "BuyShazam checkout did not expose the place-order control after wallet selection.";
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-missing-place-order");
      return result;
    }

    await Promise.all([
      page.waitForURL(/order-received|order-pay/i, { timeout: 45000 }).catch(() => {}),
      placeOrder.click(),
    ]);
    await waitForSettledPage(page, 15000);

    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const orderId = extractOrderId(currentUrl, bodyText);
    if (/order-received|thank you\. your order has been received/i.test(`${currentUrl} ${bodyText}`) || orderId) {
      result.status = "submitted";
      result.orderId = orderId;
      result.orderUrl = currentUrl;
      result.message = orderId
        ? `BuyShazam order ${orderId} was submitted using the wallet checkout flow.`
        : "BuyShazam order was submitted using the wallet checkout flow.";
      return result;
    }

    const checkoutErrors = await page
      .locator(".woocommerce-error li, .woocommerce-NoticeGroup-checkout li, [role='alert']")
      .allInnerTexts()
      .catch(() => []);
    result.status = "failed";
    result.message =
      checkoutErrors.find((entry: string) => entry.trim())?.trim() ||
      "BuyShazam checkout did not reach an order confirmation page.";
    result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-order-submit-failed");
    return result;
  } catch (error) {
    result.status = "failed";
    result.message = error instanceof Error ? error.message : String(error);
    if (page) {
      result.screenshotPath = await captureScreenshot(page, config.screenshotDir, "buyshazam-exception");
    } else if (await pathExists(config.screenshotDir)) {
      result.screenshotPath = "";
    }
    return result;
  } finally {
    await context?.close().catch(() => {});
  }
}
