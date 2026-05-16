import { getBrandById } from "@/lib/factory-data";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  getBrandOutreachAssignment,
  listOutreachAccounts,
  listSenderLaunches,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
} from "@/lib/outreach-provider-settings";
import { provisionSender } from "@/lib/outreach-provisioning";
import { loadBrandSenderLaunchView } from "@/lib/sender-launch";
import { createMissionAgentDecision, createMissionEvent } from "@/lib/mission-data";
import { inspectMissionDeliverability } from "@/lib/mission-learning";
import type { Mission, MissionDeliverabilityState, MissionPlan } from "@/lib/mission-types";
import type { OutreachAccount, SenderLaunch } from "@/lib/factory-types";

type CapacityResult = {
  mission: Mission;
  deliverabilityState: MissionDeliverabilityState;
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function brandStem(input: { websiteUrl: string; brandName: string }) {
  const domain = normalizeDomain(input.websiteUrl);
  const hostStem = domain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  const nameStem = input.brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (hostStem || nameStem || "lastb2b").slice(0, 24);
}

function domainCandidates(stem: string) {
  return [
    `${stem}mail.com`,
    `get${stem}.com`,
    `try${stem}.com`,
    `${stem}hq.com`,
    `${stem}team.com`,
    `${stem}labs.com`,
    `${stem}outreach.com`,
  ];
}

function canUseLaunchForSending(launch: SenderLaunch) {
  return launch.state === "ready" || launch.state === "restricted_send";
}

function canKeepPreparingLaunch(launch: SenderLaunch) {
  return launch.state === "setup" || launch.state === "observing" || launch.state === "warming";
}

function accountForLaunch(accounts: OutreachAccount[], launch: SenderLaunch) {
  return (
    accounts.find((account) => account.id === launch.senderAccountId) ??
    accounts.find((account) => getOutreachAccountFromEmail(account).toLowerCase() === launch.fromEmail.toLowerCase()) ??
    null
  );
}

function sortLaunches(left: SenderLaunch, right: SenderLaunch) {
  const stateRank = (launch: SenderLaunch) => {
    if (launch.state === "ready") return 4;
    if (launch.state === "restricted_send") return 3;
    if (launch.state === "warming") return 2;
    if (launch.state === "observing") return 1;
    if (launch.state === "setup") return 0;
    return -1;
  };
  const rankDiff = stateRank(right) - stateRank(left);
  if (rankDiff !== 0) return rankDiff;
  return right.readinessScore - left.readinessScore;
}

async function assignLaunchToMission(input: {
  mission: Mission;
  launch: SenderLaunch;
  account: OutreachAccount;
  readyForOutbound: boolean;
}) {
  const assignment = await setBrandOutreachAssignment(input.mission.brandId, {
    accountId: input.account.id,
    accountIds: [input.account.id],
    mailboxAccountId: input.account.id,
  });
  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "deliverability_operator",
    action: input.readyForOutbound ? "assign_ready_sender" : "assign_warming_sender",
    rationale: input.readyForOutbound
      ? "A sender already had enough launch readiness to become the mission sender lane."
      : "No ready sender was assigned, so the operator attached the best existing sender and will wait for warmup/readiness.",
    riskLevel: "guarded_write",
    input: { launchId: input.launch.id, senderAccountId: input.account.id },
    output: {
      assignment,
      fromEmail: input.launch.fromEmail,
      launchState: input.launch.state,
      readinessScore: input.launch.readinessScore,
    },
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: input.readyForOutbound ? "sender_assigned" : "sender_warmup_assigned",
    summary: input.readyForOutbound
      ? `Assigned ${input.launch.fromEmail} as the mission sender.`
      : `Assigned ${input.launch.fromEmail}; it is still ${input.launch.state}.`,
    payload: {
      launchId: input.launch.id,
      senderAccountId: input.account.id,
      readinessScore: input.launch.readinessScore,
      nextStep: input.launch.nextStep,
    },
  });
}

async function assignBestExistingSenderIfNeeded(mission: Mission) {
  const assignment = await getBrandOutreachAssignment(mission.brandId);
  if (assignment?.accountIds.length) return false;

  await loadBrandSenderLaunchView(mission.brandId).catch(() => null);
  const [accounts, launches] = await Promise.all([
    listOutreachAccounts(),
    listSenderLaunches({ brandId: mission.brandId }, { allowMissingTable: true }),
  ]);
  const candidate = launches
    .filter((launch) => canUseLaunchForSending(launch) || canKeepPreparingLaunch(launch))
    .map((launch) => ({ launch, account: accountForLaunch(accounts, launch) }))
    .filter((row): row is { launch: SenderLaunch; account: OutreachAccount } =>
      Boolean(row.account && row.account.status === "active")
    )
    .sort((left, right) => sortLaunches(left.launch, right.launch))[0] ?? null;

  if (!candidate) return false;
  await assignLaunchToMission({
    mission,
    launch: candidate.launch,
    account: candidate.account,
    readyForOutbound: canUseLaunchForSending(candidate.launch),
  });
  return true;
}

async function provisionMissionSenderIfAllowed(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}) {
  const policy = input.mission.approvalPolicy;
  if (!policy.allowAutoProvisioning || input.approvedPlan.deliverabilityPlan.autoProvisioning === false) {
    return false;
  }
  if (policy.requireApprovalForNewDomainPurchase || !policy.allowAutoDomainPurchase) {
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      agent: "deliverability_operator",
      action: "auto_domain_purchase_blocked",
      rationale: "The mission needs a sender, but the approval policy still requires approval before buying a new domain.",
      riskLevel: "blocked",
      input: { approvalPolicy: policy },
      output: {},
    });
    return false;
  }

  const [settings, secrets, brand, launches] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
    getBrandById(input.mission.brandId),
    listSenderLaunches({ brandId: input.mission.brandId }, { allowMissingTable: true }),
  ]);
  if (!brand) return false;
  const maxProvisioned = Math.max(0, policy.maxAutoProvisionedSenders ?? 1);
  const activeProvisioning = launches.filter((launch) => canKeepPreparingLaunch(launch) || canUseLaunchForSending(launch));
  if (activeProvisioning.length >= maxProvisioned) {
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      agent: "deliverability_operator",
      action: "auto_provisioning_capacity_reached",
      rationale: "The mission is allowed to provision, but it already has the maximum auto-provisioned sender capacity in flight.",
      riskLevel: "blocked",
      input: { maxAutoProvisionedSenders: maxProvisioned },
      output: { activeProvisioningCount: activeProvisioning.length },
    });
    return false;
  }
  if (!secrets.mailpoolApiKey) {
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      agent: "deliverability_operator",
      action: "auto_provisioning_missing_mailpool_credentials",
      rationale: "The mission is allowed to provision, but Mailpool credentials are missing.",
      riskLevel: "blocked",
      input: {},
      output: { hasMailpoolApiKey: false },
    });
    return false;
  }

  const stem = brandStem({ websiteUrl: input.mission.websiteUrl || brand.website, brandName: brand.name });
  const candidates = domainCandidates(stem);
  const preferredDomain = candidates[0] ?? `${stem}mail.com`;
  let result: Awaited<ReturnType<typeof provisionSender>>;
  try {
    result = await provisionSender({
      brandId: input.mission.brandId,
      provider: "mailpool",
      accountName: `${brand.name || stem} Autopilot Sender`,
      assignToBrand: true,
      domainMode: "register",
      domain: preferredDomain,
      domainCandidates: candidates,
      allowAlternativeDomains: true,
      fromLocalPart: "hello",
      forwardingTargetUrl: brand.website || input.mission.websiteUrl,
      customerIoSiteId: settings.customerIo.siteId,
      customerIoTrackingApiKey: secrets.customerIoTrackingApiKey,
      customerIoAppApiKey: secrets.customerIoAppApiKey,
      mailpoolApiKey: secrets.mailpoolApiKey,
      namecheapApiUser: settings.namecheap.apiUser,
      namecheapUserName: settings.namecheap.userName,
      namecheapApiKey: secrets.namecheapApiKey,
      namecheapClientIp: settings.namecheap.clientIp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sender provisioning failed.";
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      agent: "deliverability_operator",
      action: "auto_provisioning_failed",
      rationale: "The mission was allowed to provision a sender, but the provider call failed.",
      riskLevel: "blocked",
      input: {
        provider: "mailpool",
        domainMode: "register",
        preferredDomain,
        candidateCount: candidates.length,
      },
      output: { error: message },
    });
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "sender_provisioning_failed",
      summary: message,
      payload: { preferredDomain, candidates },
    });
    return false;
  }

  await loadBrandSenderLaunchView(input.mission.brandId).catch(() => null);
  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "deliverability_operator",
    action: "provision_mailpool_sender",
    rationale: "No usable sender was available, and the mission policy allowed automatic domain and inbox provisioning.",
    riskLevel: "guarded_write",
    input: {
      provider: "mailpool",
      domainMode: "register",
      preferredDomain,
      candidateCount: candidates.length,
    },
    output: {
      ok: result.ok,
      readyToSend: result.readyToSend,
      domain: result.domain,
      fromEmail: result.fromEmail,
      warnings: result.warnings,
      nextSteps: result.nextSteps,
      mailpool: result.mailpool,
    },
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: "sender_provisioned",
    summary: `Provisioned ${result.fromEmail}; waiting for domain/mailbox readiness before sending.`,
    payload: {
      domain: result.domain,
      fromEmail: result.fromEmail,
      readyToSend: result.readyToSend,
      warnings: result.warnings,
      nextSteps: result.nextSteps,
    },
  });
  return true;
}

export async function ensureMissionDeliverabilityCapacity(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}): Promise<CapacityResult> {
  let deliverabilityState = await inspectMissionDeliverability(input.mission.brandId);
  if (deliverabilityState.stage === "ready") {
    return { mission: input.mission, deliverabilityState };
  }

  const assignedExisting = await assignBestExistingSenderIfNeeded(input.mission);
  if (assignedExisting) {
    deliverabilityState = await inspectMissionDeliverability(input.mission.brandId);
    return { mission: input.mission, deliverabilityState };
  }

  const provisioned = await provisionMissionSenderIfAllowed(input);
  if (provisioned) {
    deliverabilityState = await inspectMissionDeliverability(input.mission.brandId);
    return { mission: input.mission, deliverabilityState };
  }

  return { mission: input.mission, deliverabilityState };
}
