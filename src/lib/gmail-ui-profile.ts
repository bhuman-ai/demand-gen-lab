import path from "path";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function buildGmailUiProfileSlug(email: string) {
  return normalizeEmail(email).replace(/[^a-z0-9._-]+/g, "_");
}

export function buildGmailUiUserDataDir(profileRoot: string, email: string) {
  const root = String(profileRoot ?? "").trim();
  if (!root) return "";
  return path.join(root, buildGmailUiProfileSlug(email));
}

export function isWithinGmailUiProfileRoot(targetPath: string, profileRoot: string) {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(profileRoot);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

export function resolveGmailUiUserDataDir(input: {
  profileRoot?: string;
  existingUserDataDir?: string;
  email?: string;
}) {
  const profileRoot = String(input.profileRoot ?? "").trim();
  const existingUserDataDir = String(input.existingUserDataDir ?? "").trim();
  const email = String(input.email ?? "").trim();
  if (!profileRoot) {
    return {
      userDataDir: existingUserDataDir,
      rehomedProfile: false,
    };
  }
  if (existingUserDataDir && isWithinGmailUiProfileRoot(existingUserDataDir, profileRoot)) {
    return {
      userDataDir: existingUserDataDir,
      rehomedProfile: false,
    };
  }
  return {
    userDataDir: buildGmailUiUserDataDir(profileRoot, email),
    rehomedProfile: true,
  };
}
