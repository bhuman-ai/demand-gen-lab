alter table demanddev_run_anomalies
drop constraint if exists demanddev_run_anomalies_type_check;

alter table demanddev_run_anomalies
add constraint demanddev_run_anomalies_type_check
check (
  type in (
    'hard_bounce_rate',
    'spam_complaint_rate',
    'provider_error_rate',
    'negative_reply_rate_spike',
    'deliverability_inbox_placement'
  )
);
