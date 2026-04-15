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
    "social": {
      "enabled": false,
      "connectionProvider": "none",
      "externalAccountId": "",
      "handle": "",
      "profileUrl": "",
      "role": "operator",
      "topicTags": [],
      "communityTags": [],
      "platforms": [],
      "regions": [],
      "languages": [],
      "audienceTypes": [],
      "trustLevel": 0,
      "cooldownMinutes": 120,
      "lastSocialCommentAt": "",
      "recentActivity24h": 0,
      "recentActivity7d": 0,
      "coordinationGroup": "",
      "notes": ""
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
set config = jsonb_set(
  coalesce(config, '{}'::jsonb),
  '{social}',
  '{
    "enabled": false,
    "connectionProvider": "none",
    "externalAccountId": "",
    "handle": "",
    "profileUrl": "",
    "role": "operator",
    "topicTags": [],
    "communityTags": [],
    "platforms": [],
    "regions": [],
    "languages": [],
    "audienceTypes": [],
    "trustLevel": 0,
    "cooldownMinutes": 120,
    "lastSocialCommentAt": "",
    "recentActivity24h": 0,
    "recentActivity7d": 0,
    "coordinationGroup": "",
    "notes": ""
  }'::jsonb || coalesce(config->'social', '{}'::jsonb),
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
    jsonb_typeof(config->'social') = 'object' and
    jsonb_typeof(config->'mailbox') = 'object' and
    (config->'customerIo' ? 'fromEmail') and
    (config->'customerIo' ? 'replyToEmail') and
    (config->'mailpool' ? 'mailboxId') and
    (config->'social' ? 'enabled') and
    (config->'social' ? 'platforms') and
    (config->'social' ? 'role') and
    (config->'mailbox' ? 'smtpHost') and
    (config->'mailbox' ? 'smtpPort') and
    (config->'mailbox' ? 'smtpUsername')
  );
