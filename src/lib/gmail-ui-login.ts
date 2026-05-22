import { updateOutreachAccount } from "@/lib/outreach-data";
import type { GmailUiLoginState, OutreachAccount } from "@/lib/factory-types";

export type GmailUiSessionCheck = {
  state: OutreachAccount["config"]["mailbox"]["gmailUiLoginState"];
  summary: string;
  currentUrl: string;
  title: string;
  composeVisible: boolean;
};

function isKnownLoginState(value: string): value is GmailUiLoginState {
  return ["unknown", "login_required", "ready", "error"].includes(value);
}

export function normalizeGmailUiLoginStatus(input: {
  deliveryMethod: OutreachAccount["config"]["mailbox"]["deliveryMethod"];
  state?: string;
  checkedAt?: string;
  message?: string;
  forceLoginRequired?: boolean;
}) {
  if (input.deliveryMethod !== "gmail_ui") {
    return {
      gmailUiLoginState: "unknown" as const,
      gmailUiLoginCheckedAt: "",
      gmailUiLoginMessage: "",
    };
  }

  const requestedState = String(input.state ?? "").trim();
  const currentState = isKnownLoginState(requestedState) ? requestedState : "unknown";
  const shouldRequireLogin =
    input.forceLoginRequired || currentState === "unknown" || !currentState;
  const gmailUiLoginState =
    shouldRequireLogin ? ("login_required" as const) : currentState;
  const gmailUiLoginCheckedAt =
    gmailUiLoginState === "login_required" && shouldRequireLogin
      ? ""
      : String(input.checkedAt ?? "").trim();
  const fallbackMessage =
    gmailUiLoginState === "ready"
      ? "Gmail inbox is open and the Compose button is visible."
      : gmailUiLoginState === "error"
        ? "Gmail session check failed on the worker."
        : "Open this sender on the worker and complete Gmail login.";

  return {
    gmailUiLoginState,
    gmailUiLoginCheckedAt,
    gmailUiLoginMessage: String(input.message ?? "").trim() || fallbackMessage,
  };
}

const COMPOSE_SELECTOR =
  'div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")';

const INBOX_SHELL_SELECTOR = [
  '[role="main"]',
  '[role="navigation"]',
  '[aria-label*="Inbox"]',
  '[aria-label*="Mail"]',
  'input[aria-label*="Search in mail"]',
  'input[placeholder="Search mail"]',
].join(", ");

export async function inspectGmailUiSession(page: any): Promise<GmailUiSessionCheck> {
  const currentUrl = String(page.url() ?? "");
  const title = String((await page.title().catch(() => "")) ?? "");
  const titleLower = title.toLowerCase();
  const composeVisible = await page.locator(COMPOSE_SELECTOR).first().isVisible().catch(() => false);
  if (composeVisible) {
    return {
      state: "ready",
      summary: "Gmail inbox is open and the Compose button is visible.",
      currentUrl,
      title,
      composeVisible: true,
    };
  }

  const bodyText = String((await page.locator("body").innerText().catch(() => "")) ?? "").toLowerCase();
  const inboxShellVisible =
    currentUrl.includes("mail.google.com/mail/") &&
    !currentUrl.includes("accounts.google.com") &&
    !currentUrl.startsWith("chrome-error://") &&
    titleLower.includes("mail") &&
    (
      /#(inbox|all|starred|snoozed|sent|drafts|spam|trash|label|search|settings)/i.test(currentUrl) ||
      currentUrl.includes("tf=cm") ||
      currentUrl.includes("fs=1") ||
      titleLower.includes("compose mail") ||
      bodyText.includes("inbox") ||
      bodyText.includes("compose") ||
      bodyText.includes("search in mail") ||
      bodyText.includes("search mail") ||
      Boolean(await page.locator(INBOX_SHELL_SELECTOR).first().isVisible().catch(() => false))
    );
  if (inboxShellVisible) {
    return {
      state: "ready",
      summary: "Gmail inbox shell is open for this sender profile.",
      currentUrl,
      title,
      composeVisible: false,
    };
  }

  const googleAccountNotFound =
    bodyText.includes("couldn’t find your google account") ||
    bodyText.includes("couldn't find your google account") ||
    bodyText.includes("could not find your google account");
  if (googleAccountNotFound) {
    return {
      state: "error",
      summary: "Google could not find this sender account. The mailbox is not a usable Google login yet.",
      currentUrl,
      title,
      composeVisible: false,
    };
  }

  const googleRejectedBrowser =
    currentUrl.includes("/signin/rejected") ||
    titleLower.includes("couldn") ||
    bodyText.includes("this browser or app may not be secure") ||
    bodyText.includes("try using a different browser");
  if (googleRejectedBrowser) {
    return {
      state: "error",
      summary:
        "Google rejected this Gmail UI browser as insecure during sign-in. The sender profile needs a hardened browser launch or manual bootstrap.",
      currentUrl,
      title,
      composeVisible: false,
    };
  }

  const looksLikeLogin =
    currentUrl.includes("accounts.google.com") ||
    titleLower.includes("sign in") ||
    bodyText.includes("choose an account") ||
    bodyText.includes("to continue to gmail") ||
    bodyText.includes("verify it") ||
    bodyText.includes("enter your password");

  if (looksLikeLogin) {
    return {
      state: "login_required",
      summary: "Gmail is showing a login or verification screen for this sender profile.",
      currentUrl,
      title,
      composeVisible: false,
    };
  }

  return {
    state: "error",
    summary: "Gmail opened, but the session did not reach the inbox and no login screen was recognized.",
    currentUrl,
    title,
    composeVisible: false,
  };
}

export async function persistGmailUiSessionCheck(accountId: string, check: GmailUiSessionCheck) {
  return updateOutreachAccount(accountId, {
    config: {
      mailbox: {
        gmailUiLoginState: check.state,
        gmailUiLoginCheckedAt: new Date().toISOString(),
        gmailUiLoginMessage: check.summary,
      },
    },
  });
}
