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
    "deliverability": {
      "provider": "none",
      "monitoredDomains": [],
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
    '{deliverability}',
    '{
      "provider": "none",
      "monitoredDomains": [],
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

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demanddev_outreach_provisioning_settings_config_shape_chk'
  ) then
    alter table demanddev_outreach_provisioning_settings
      add constraint demanddev_outreach_provisioning_settings_config_shape_chk
      check (
        jsonb_typeof(config) = 'object' and
        jsonb_typeof(config->'customerIo') = 'object' and
        jsonb_typeof(config->'namecheap') = 'object' and
        jsonb_typeof(config->'deliverability') = 'object' and
        (config->'deliverability' ? 'provider') and
        (config->'deliverability' ? 'monitoredDomains') and
        (config->'deliverability' ? 'lastCheckedAt')
      );
  end if;
end $$;

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
    "apify": {
      "defaultActorId": ""
    },
    "mailbox": {
      "provider": "gmail",
      "email": "",
      "status": "disconnected",
      "host": "",
      "port": 993,
      "secure": true
    }
  }'::jsonb;

update demanddev_outreach_accounts
set config =
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
      "secure": true
    }'::jsonb || coalesce(config->'mailbox', '{}'::jsonb),
    true
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demanddev_outreach_accounts_config_shape_chk'
  ) then
    alter table demanddev_outreach_accounts
      add constraint demanddev_outreach_accounts_config_shape_chk
      check (
        jsonb_typeof(config) = 'object' and
        jsonb_typeof(config->'customerIo') = 'object' and
        jsonb_typeof(config->'customerIo'->'billing') = 'object' and
        jsonb_typeof(config->'apify') = 'object' and
        jsonb_typeof(config->'mailbox') = 'object' and
        (config->'customerIo' ? 'fromEmail') and
        (config->'customerIo' ? 'replyToEmail')
      );
  end if;
end $$;
