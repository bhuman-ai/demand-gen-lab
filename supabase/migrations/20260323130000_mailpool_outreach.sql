alter table if exists demanddev_outreach_accounts
  drop constraint if exists demanddev_outreach_accounts_provider_check;

alter table if exists demanddev_outreach_accounts
  add constraint demanddev_outreach_accounts_provider_check
  check (provider in ('customerio', 'mailpool'));

alter table if exists demanddev_outreach_provisioning_settings
  alter column config set default '{
    "customerIo": {
      "siteId": "",
      "workspaceRegion": "unknown",
      "lastValidatedAt": "",
      "lastValidatedStatus": "unknown",
      "lastValidationMessage": ""
    },
    "namecheap": {
      "apiUser": "",
      "userName": "",
      "clientIp": "",
      "lastValidatedAt": "",
      "lastValidatedStatus": "unknown",
      "lastValidationMessage": ""
    },
    "mailpool": {
      "webhookUrl": "https://lastb2b.com/api/webhooks/mailpool/events",
      "lastValidatedAt": "",
      "lastValidatedStatus": "unknown",
      "lastValidationMessage": ""
    },
    "deliverability": {
      "provider": "none",
      "monitoredDomains": [],
      "mailpoolInboxProviders": ["GoogleWorkspace", "Gmail", "Outlook", "M365Outlook", "Yahoo", "Hotmail"],
      "lastValidatedAt": "",
      "lastValidatedStatus": "unknown",
      "lastValidationMessage": "",
      "lastCheckedAt": "",
      "lastHealthStatus": "unknown",
      "lastHealthScore": 0,
      "lastHealthSummary": "",
      "lastDomainSnapshots": []
    }
  }'::jsonb;

update demanddev_outreach_provisioning_settings
set config =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(config, '{}'::jsonb),
          '{customerIo}',
          '{
            "siteId": "",
            "workspaceRegion": "unknown",
            "lastValidatedAt": "",
            "lastValidatedStatus": "unknown",
            "lastValidationMessage": ""
          }'::jsonb || coalesce(config->'customerIo', '{}'::jsonb),
          true
        ),
        '{namecheap}',
        '{
          "apiUser": "",
          "userName": "",
          "clientIp": "",
          "lastValidatedAt": "",
          "lastValidatedStatus": "unknown",
          "lastValidationMessage": ""
        }'::jsonb || coalesce(config->'namecheap', '{}'::jsonb),
        true
      ),
      '{mailpool}',
      '{
        "webhookUrl": "https://lastb2b.com/api/webhooks/mailpool/events",
        "lastValidatedAt": "",
        "lastValidatedStatus": "unknown",
        "lastValidationMessage": ""
      }'::jsonb || coalesce(config->'mailpool', '{}'::jsonb),
      true
    ),
    '{deliverability}',
    '{
      "provider": "none",
      "monitoredDomains": [],
      "mailpoolInboxProviders": ["GoogleWorkspace", "Gmail", "Outlook", "M365Outlook", "Yahoo", "Hotmail"],
      "lastValidatedAt": "",
      "lastValidatedStatus": "unknown",
      "lastValidationMessage": "",
      "lastCheckedAt": "",
      "lastHealthStatus": "unknown",
      "lastHealthScore": 0,
      "lastHealthSummary": "",
      "lastDomainSnapshots": []
    }'::jsonb || coalesce(config->'deliverability', '{}'::jsonb),
    true
  );

update demanddev_outreach_provisioning_settings
set config = jsonb_set(
  config,
  '{mailpool,webhookUrl}',
  to_jsonb('https://lastb2b.com/api/webhooks/mailpool/events'::text),
  true
)
where coalesce(config->'mailpool'->>'webhookUrl', '') in (
  '',
  'https://demand-gen-lab.vercel.app/api/webhooks/mailpool/events'
);

alter table if exists demanddev_outreach_provisioning_settings
  drop constraint if exists demanddev_outreach_provisioning_settings_config_shape_chk;

alter table if exists demanddev_outreach_provisioning_settings
  add constraint demanddev_outreach_provisioning_settings_config_shape_chk
  check (
    jsonb_typeof(config) = 'object' and
    jsonb_typeof(config->'customerIo') = 'object' and
    jsonb_typeof(config->'namecheap') = 'object' and
    jsonb_typeof(config->'mailpool') = 'object' and
    jsonb_typeof(config->'deliverability') = 'object' and
    (config->'mailpool' ? 'webhookUrl') and
    (config->'deliverability' ? 'provider') and
    (config->'deliverability' ? 'monitoredDomains') and
    (config->'deliverability' ? 'mailpoolInboxProviders') and
    (config->'deliverability' ? 'lastCheckedAt')
  );

alter table if exists demanddev_outreach_accounts
  alter column config set default '{
    "customerIo": {
      "siteId": "",
      "workspaceId": "",
      "fromEmail": "",
      "replyToEmail": "",
      "billing": {
        "monthlyProfileLimit": 30000,
        "billingCycleAnchorDay": 1,
        "currentPeriodStart": "",
        "currentPeriodBaselineProfiles": 0,
        "currentPeriodBaselineSyncedAt": "",
        "lastWorkspacePeopleCount": 0,
        "lastWorkspacePeopleCountAt": ""
      }
    },
    "mailpool": {
      "domainId": "",
      "mailboxId": "",
      "mailboxType": "google",
      "spamCheckId": "",
      "inboxPlacementId": "",
      "status": "pending",
      "lastSpamCheckAt": "",
      "lastSpamCheckScore": 0,
      "lastSpamCheckSummary": ""
    },
    "apify": {
      "defaultActorId": ""
    },
    "mailbox": {
      "provider": "gmail",
      "email": "",
      "status": "disconnected",
      "host": "",
      "port": 993,
      "secure": true,
      "smtpHost": "",
      "smtpPort": 587,
      "smtpSecure": false,
      "smtpUsername": ""
    }
  }'::jsonb;

update demanddev_outreach_accounts
set config =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(config, '{}'::jsonb),
            '{customerIo}',
            '{
              "siteId": "",
              "workspaceId": "",
              "fromEmail": "",
              "replyToEmail": "",
              "billing": {
                "monthlyProfileLimit": 30000,
                "billingCycleAnchorDay": 1,
                "currentPeriodStart": "",
                "currentPeriodBaselineProfiles": 0,
                "currentPeriodBaselineSyncedAt": "",
                "lastWorkspacePeopleCount": 0,
                "lastWorkspacePeopleCountAt": ""
              }
            }'::jsonb || coalesce(config->'customerIo', '{}'::jsonb),
            true
          ),
          '{customerIo,billing}',
          '{
            "monthlyProfileLimit": 30000,
            "billingCycleAnchorDay": 1,
            "currentPeriodStart": "",
            "currentPeriodBaselineProfiles": 0,
            "currentPeriodBaselineSyncedAt": "",
            "lastWorkspacePeopleCount": 0,
            "lastWorkspacePeopleCountAt": ""
          }'::jsonb || coalesce(config->'customerIo'->'billing', '{}'::jsonb),
          true
        ),
        '{mailpool}',
        '{
          "domainId": "",
          "mailboxId": "",
          "mailboxType": "google",
          "spamCheckId": "",
          "inboxPlacementId": "",
          "status": "pending",
          "lastSpamCheckAt": "",
          "lastSpamCheckScore": 0,
          "lastSpamCheckSummary": ""
        }'::jsonb || coalesce(config->'mailpool', '{}'::jsonb),
        true
      ),
      '{apify}',
      '{
        "defaultActorId": ""
      }'::jsonb || coalesce(config->'apify', '{}'::jsonb),
      true
    ),
    '{mailbox}',
    '{
      "provider": "gmail",
      "email": "",
      "status": "disconnected",
      "host": "",
      "port": 993,
      "secure": true,
      "smtpHost": "",
      "smtpPort": 587,
      "smtpSecure": false,
      "smtpUsername": ""
    }'::jsonb || coalesce(config->'mailbox', '{}'::jsonb),
    true
  );

alter table if exists demanddev_outreach_accounts
  drop constraint if exists demanddev_outreach_accounts_config_shape_chk;

alter table if exists demanddev_outreach_accounts
  add constraint demanddev_outreach_accounts_config_shape_chk
  check (
    jsonb_typeof(config) = 'object' and
    jsonb_typeof(config->'customerIo') = 'object' and
    jsonb_typeof(config->'customerIo'->'billing') = 'object' and
    jsonb_typeof(config->'mailpool') = 'object' and
    jsonb_typeof(config->'apify') = 'object' and
    jsonb_typeof(config->'mailbox') = 'object' and
    (config->'customerIo' ? 'fromEmail') and
    (config->'customerIo' ? 'replyToEmail') and
    (config->'mailpool' ? 'mailboxId') and
    (config->'mailbox' ? 'smtpHost') and
    (config->'mailbox' ? 'smtpPort') and
    (config->'mailbox' ? 'smtpUsername')
  );
