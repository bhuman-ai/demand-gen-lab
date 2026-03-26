#!/usr/bin/env python3
import copy
import json
import sys
import time
import urllib.error
import urllib.request


BASE_URL = "http://127.0.0.1:3002"
BRAND_ID = "brand_7bfdb4d1686b4afc"
TEMPLATE_CAMPAIGN_ID = "camp_859bbfb62a8d4cea"
TEMPLATE_RUNTIME_EXPERIMENT_ID = "exp_def35334cbff4729"
AGENCY_QUALITY_SUFFIX = (
    " Return only agencies, consultancies, or established independent specialists with a standalone business website on their own domain. "
    "Return named experts, not anonymous company-only rows. "
    "Exclude marketplace profiles, freelance directories, software vendors that do not offer services, in-house brand employees, job boards, and rows that only point to LinkedIn or directory pages. "
    "Prefer founders, partners, heads of paid social, retention leads, strategists, operators, or senior consultants with a visible agency, consultancy, or specialist brand."
)

SEARCH_HINTS_BY_REPORT_LABEL = {
    "US Small Accounting Automation Report": "Useful sourcing terms include accounting firm automation consultant, bookkeeping workflow automation, QuickBooks automation consultant, CAS workflow consultant, and accounting practice operations specialist.",
    "Canadian Accounting Automation Report": "Useful sourcing terms include bookkeeping automation Canada, accounting workflow consultant Canada, QuickBooks automation consultant, payroll workflow agency, and accounting operations specialist.",
    "US Accounting Automation Report": "Useful sourcing terms include accounting ops consultant, accounting workflow automation agency, CAS automation consultant, reconciliation automation, and accounting practice systems implementation.",
    "Canadian Legal Operations Report": "Useful sourcing terms include legal ops consultant Canada, law firm intake automation, Clio consultant Canada, legal workflow automation, and legal admin systems specialist.",
    "Europe GTM Hiring Report": "Useful sourcing terms include RevOps consultant Europe, GTM engineer Europe, HubSpot partner startup Europe, outbound systems agency Europe, and post-fund GTM advisor.",
    "French eCommerce Channel Report": "Useful local sourcing terms include agence paid social France, agence TikTok France, agence acquisition e-commerce, agence Meta Ads e-commerce, agence Shopify France, and DTC growth agency France.",
    "German eCommerce Channel Report": "Useful local sourcing terms include Performance Marketing Agentur, Social Ads Agentur, TikTok Agentur, Shopify Agentur, E-Commerce Agentur, and DTC Growth Agentur in Germany.",
    "Spanish eCommerce Channel Report": "Useful local sourcing terms include agencia paid social ecommerce, agencia TikTok Ads, agencia Shopify, agencia performance ecommerce, and agencia growth DTC in Spain.",
    "Swedish eCommerce Channel Report": "Useful local sourcing terms include performance marketing byrå, paid social agency Sweden, TikTok agency Sweden, Shopify agency Sweden, and ecommerce growth agency Sweden.",
    "UK eCommerce Channel Report": "Useful sourcing terms include paid social agency Shopify UK, TikTok agency DTC UK, ecommerce growth agency UK, Shopify growth consultancy, and Meta Ads agency ecommerce UK.",
    "Dutch eCommerce Channel Report": "Useful local sourcing terms include performance marketing bureau, social advertising bureau, TikTok agency Netherlands, Shopify bureau, and ecommerce growth agency Netherlands.",
    "French Retention Stack Report": "Useful local sourcing terms include agence CRM France, agence emailing, agence email marketing ecommerce, agence Klaviyo, agence SMS marketing, and retention ecommerce France.",
    "German Retention Stack Report": "Useful local sourcing terms include CRM Agentur, E-Mail Marketing Agentur, Klaviyo Agentur, Shopify Retention Agentur, SMS Marketing Agentur, and Lifecycle Marketing Agentur in Germany.",
}

EXCLUSION_HINTS_BY_REPORT_LABEL = {
    "US Small Accounting Automation Report": "Exclude accounting firms themselves, CPA practices, tax firms, payroll bureaus, bookkeeping firms, software vendors, and industry publishers.",
    "Canadian Accounting Automation Report": "Exclude accounting firms themselves, CPA practices, tax firms, bookkeeping firms, software vendors, and industry publishers.",
    "US Accounting Automation Report": "Exclude accounting firms themselves, CPA practices, tax firms, bookkeeping firms, software vendors, and industry publishers.",
    "Canadian Legal Operations Report": "Exclude law firms themselves, attorneys in private practice, legal directories, legal publishers, and software vendors that do not deliver services.",
    "Europe GTM Hiring Report": "Exclude VCs, recruiters, startup media, research firms, and software vendors that do not provide RevOps, outbound, or GTM systems services.",
    "French eCommerce Channel Report": "Exclude ecommerce brands themselves, software vendors, newsletters, publishers, training communities, and generic media sites.",
    "German eCommerce Channel Report": "Exclude ecommerce brands themselves, software vendors, newsletters, publishers, training communities, and generic media sites.",
    "Spanish eCommerce Channel Report": "Exclude ecommerce brands themselves, software vendors, newsletters, publishers, training communities, and generic media sites.",
    "Swedish eCommerce Channel Report": "Exclude ecommerce brands themselves, software vendors, newsletters, publishers, training communities, and generic media sites.",
    "UK eCommerce Channel Report": "Exclude ecommerce brands themselves, software vendors, newsletters, publishers, training communities, and generic media sites.",
    "Dutch eCommerce Channel Report": "Exclude ecommerce brands themselves, software vendors, newsletters, publishers, training communities, and generic media sites.",
    "French Retention Stack Report": "Exclude ecommerce brands themselves, software vendors, publishers, and generalist agencies without clear retention, email, SMS, or lifecycle proof.",
    "German Retention Stack Report": "Exclude ecommerce brands themselves, software vendors, publishers, and generalist agencies without clear retention, email, SMS, or lifecycle proof.",
}


def build_named_expert_prompt(search_line, proof_line, report_topic):
    return (
        f"{search_line} "
        "Prefer one named person per agency: founder, partner, director, head of department, or senior consultant who is clearly close to client work. "
        f"{proof_line} "
        f"Return person name, title, company name, company website, usable company domain or work email, location, source URL, proof, and why they are a credible expert to comment on a report about {report_topic}."
    )


def build_accounting_prompt(country_phrase, market_phrase, report_topic):
    return build_named_expert_prompt(
        f"Find named experts at AI automation consultancies, bookkeeping workflow agencies, accounting operations consultancies, and workflow specialists that serve {country_phrase} accounting firms. "
        f"Prioritize experts who specifically work with {market_phrase}.",
        "Require public proof on the agency site, founder bio, service page, or case study that they automate bookkeeping, payroll, reconciliation, client onboarding, document collection, or accounting workflows.",
        report_topic,
    )


def build_legal_prompt(country_phrase, report_topic):
    return build_named_expert_prompt(
        f"Find named experts at legal operations consultancies, intake automation agencies, Clio consultants, and workflow specialists that serve law firms in {country_phrase}.",
        "Require public proof on the agency site, founder bio, service page, or case study that they improve intake, admin, document collection, matter management, or legal workflow operations for law firms.",
        report_topic,
    )


def build_gtm_prompt(region_phrase, report_topic):
    return build_named_expert_prompt(
        f"Find named experts at RevOps consultancies, GTM engineering firms, outbound systems agencies, and post-fund GTM operators that serve funded B2B startups in {region_phrase}.",
        "Require public proof on the agency site, founder bio, service page, or case study that they build outbound systems, CRM operations, RevOps, GTM infrastructure, or post-fund sales operations.",
        report_topic,
    )


def build_ecommerce_channel_prompt(country_adjective, country_phrase, report_topic):
    return build_named_expert_prompt(
        f"Find named experts at {country_adjective} paid-social agencies, TikTok agencies, eCommerce growth agencies, Shopify consultancies, and DTC growth firms that serve {country_phrase} Shopify or DTC brands.",
        f"Require public proof on the agency site, founder bio, team page, or case studies that they run Meta, TikTok, paid social, ecommerce acquisition, or Shopify growth work for {country_phrase} brands.",
        report_topic,
    )


def build_retention_prompt(country_adjective, country_phrase, report_topic):
    return build_named_expert_prompt(
        f"Find named experts at {country_adjective} retention agencies, lifecycle agencies, email marketing agencies, SMS agencies, Klaviyo consultancies, and Shopify CRM specialists that serve {country_phrase} Shopify brands.",
        f"Require public proof on the agency site, founder bio, team page, or case studies that they run Klaviyo, email, SMS, CRM, or lifecycle programs for {country_phrase} ecommerce brands.",
        report_topic,
    )


REPORT_CONFIGS = [
    {
        "name": "Report comment outreach · US Small Accounting Automation Report",
        "report_label": "US Small Accounting Automation Report",
        "report_url": "https://www.enrichanything.com/reports/accounting-automation-gap",
        "audience": "US AI automation consultants, bookkeeping workflow agencies, and operations freelancers serving small accounting firms.",
        "topic": "smaller US accounting firms showing visible back-office hiring pressure without visible automation tooling",
        "prompt": build_accounting_prompt(
            "US",
            "smaller accounting firms in the US",
            "small US accounting firms hiring around process pain before automating",
        ),
        "questions": [
            "Why does this pattern show up in small accounting firms in the first place?",
            "What usually turns out to be noise or a false positive?",
            "What would you want to verify before treating this as a real automation opportunity?",
        ],
    },
    {
        "name": "Report comment outreach · Canadian Accounting Automation Report",
        "report_label": "Canadian Accounting Automation Report",
        "report_url": "https://www.enrichanything.com/reports/canada-accounting-automation-gap",
        "audience": "Canadian AI automation consultants, workflow agencies, and operations freelancers serving accounting firms.",
        "topic": "Canadian accounting firms showing visible back-office hiring pressure without visible automation tooling",
        "prompt": build_accounting_prompt(
            "Canadian",
            "accounting firms in Canada",
            "Canadian accounting firms hiring around process pain before automating",
        ),
        "questions": [
            "Why does this pattern show up in Canadian accounting firms?",
            "What usually creates false positives in a list like this?",
            "What would you check before calling this a real automation opportunity?",
        ],
    },
    {
        "name": "Report comment outreach · US Accounting Automation Report",
        "report_label": "US Accounting Automation Report",
        "report_url": "https://www.enrichanything.com/reports/us-accounting-automation-gap-10-100",
        "audience": "US AI automation consultants, accounting workflow agencies, and ops specialists serving mid-sized accounting firms.",
        "topic": "US accounting firms in a broader size band showing visible back-office hiring pressure without visible automation tooling",
        "prompt": build_accounting_prompt(
            "US",
            "US accounting firms with roughly 10 to 100 employees",
            "mid-sized US accounting firms hiring around process pain before automating",
        ),
        "questions": [
            "Why do firms in this size band keep hiring around process pain instead of automating sooner?",
            "What usually turns out to be noise in this segment?",
            "What evidence would make this list commercially actionable to you?",
        ],
    },
    {
        "name": "Report comment outreach · Canadian Legal Operations Report",
        "report_label": "Canadian Legal Operations Report",
        "report_url": "https://www.enrichanything.com/reports/canada-law-firm-automation-gap",
        "audience": "Canadian legal ops consultants, intake automation agencies, and workflow specialists serving law firms.",
        "topic": "Canadian law firms showing visible intake and admin pressure without mature automation tooling",
        "prompt": build_legal_prompt(
            "Canada",
            "Canadian law firms hiring around intake and admin workload before automating",
        ),
        "questions": [
            "Why does this intake and admin pressure pattern show up in smaller law firms?",
            "What are the most common false positives in a list like this?",
            "What operational proof would you want before treating this as a real workflow opportunity?",
        ],
    },
    {
        "name": "Report comment outreach · Europe GTM Hiring Report",
        "report_label": "Europe GTM Hiring Report",
        "report_url": "https://www.enrichanything.com/reports/europe-funded-gtm-hiring-gap",
        "audience": "European RevOps consultants, GTM engineers, outbound systems agencies, and post-fund GTM operators.",
        "topic": "recently funded startups in Europe that appear to be building GTM leadership before the sales system is fully built",
        "prompt": build_gtm_prompt(
            "Europe",
            "recently funded startups in Europe hiring GTM leaders before the sales system is fully built",
        ),
        "questions": [
            "Why does this timing pattern tend to show up right after funding?",
            "How strong is it really as a signal for RevOps or outbound work?",
            "What would you check before acting on a company from this list?",
        ],
    },
    {
        "name": "Report comment outreach · French eCommerce Channel Report",
        "report_label": "French eCommerce Channel Report",
        "report_url": "https://www.enrichanything.com/reports/france-meta-tiktok-gap",
        "audience": "French paid-social agencies, TikTok agencies, eCommerce growth agencies, and Shopify consultants.",
        "topic": "French Shopify brands that appear active on Meta without visible TikTok setup",
        "prompt": build_ecommerce_channel_prompt(
            "French",
            "French",
            "French Shopify brands active on Meta without visible TikTok setup",
        ),
        "questions": [
            "Why does this pattern tend to exist in the French market?",
            "Where do the false positives usually come from?",
            "What would make a list like this genuinely useful from an agency perspective?",
        ],
    },
    {
        "name": "Report comment outreach · German eCommerce Channel Report",
        "report_label": "German eCommerce Channel Report",
        "report_url": "https://www.enrichanything.com/reports/germany-meta-tiktok-gap",
        "audience": "German paid-social agencies, TikTok agencies, eCommerce growth agencies, and Shopify consultants.",
        "topic": "German Shopify brands that appear active on Meta without visible TikTok setup",
        "prompt": build_ecommerce_channel_prompt(
            "German",
            "German",
            "German Shopify brands active on Meta without visible TikTok setup",
        ),
        "questions": [
            "Why does this pattern tend to exist in the German market?",
            "Where do the false positives usually come from?",
            "What would make a list like this genuinely useful from an agency perspective?",
        ],
    },
    {
        "name": "Report comment outreach · Spanish eCommerce Channel Report",
        "report_label": "Spanish eCommerce Channel Report",
        "report_url": "https://www.enrichanything.com/reports/spain-meta-tiktok-gap",
        "audience": "Spanish paid-social agencies, TikTok agencies, eCommerce growth agencies, and Shopify consultants.",
        "topic": "Spanish Shopify brands that appear active on Meta without visible TikTok setup",
        "prompt": build_ecommerce_channel_prompt(
            "Spanish",
            "Spanish",
            "Spanish Shopify brands active on Meta without visible TikTok setup",
        ),
        "questions": [
            "Why does this pattern tend to exist in the Spanish market?",
            "Where do the false positives usually come from?",
            "What would make a list like this genuinely useful from an agency perspective?",
        ],
    },
    {
        "name": "Report comment outreach · Swedish eCommerce Channel Report",
        "report_label": "Swedish eCommerce Channel Report",
        "report_url": "https://www.enrichanything.com/reports/sweden-meta-tiktok-gap",
        "audience": "Swedish paid-social agencies, TikTok agencies, eCommerce growth agencies, and Shopify consultants.",
        "topic": "Swedish Shopify brands that appear active on Meta without visible TikTok setup",
        "prompt": build_ecommerce_channel_prompt(
            "Swedish",
            "Swedish",
            "Swedish Shopify brands active on Meta without visible TikTok setup",
        ),
        "questions": [
            "Why does this pattern tend to exist in the Swedish market?",
            "Where do the false positives usually come from?",
            "What would make a list like this genuinely useful from an agency perspective?",
        ],
    },
    {
        "name": "Report comment outreach · UK eCommerce Channel Report",
        "report_label": "UK eCommerce Channel Report",
        "report_url": "https://www.enrichanything.com/reports/uk-meta-tiktok-gap",
        "audience": "UK paid-social agencies, TikTok agencies, eCommerce growth agencies, and Shopify consultants.",
        "topic": "UK Shopify brands that appear active on Meta without visible TikTok setup",
        "prompt": build_ecommerce_channel_prompt(
            "UK",
            "UK",
            "UK Shopify brands active on Meta without visible TikTok setup",
        ),
        "questions": [
            "Why does this pattern tend to exist in the UK market?",
            "Where do the false positives usually come from?",
            "What would make a list like this genuinely useful from an agency perspective?",
        ],
    },
    {
        "name": "Report comment outreach · Dutch eCommerce Channel Report",
        "report_label": "Dutch eCommerce Channel Report",
        "report_url": "https://www.enrichanything.com/reports/netherlands-meta-tiktok-gap",
        "audience": "Dutch paid-social agencies, TikTok agencies, eCommerce growth agencies, and Shopify consultants.",
        "topic": "Dutch Shopify brands that appear active on Meta without visible TikTok setup",
        "prompt": build_ecommerce_channel_prompt(
            "Dutch",
            "Dutch",
            "Dutch Shopify brands active on Meta without visible TikTok setup",
        ),
        "questions": [
            "Why does this pattern tend to exist in the Dutch market?",
            "Where do the false positives usually come from?",
            "What would make a list like this genuinely useful from an agency perspective?",
        ],
    },
    {
        "name": "Report comment outreach · French Retention Stack Report",
        "report_label": "French Retention Stack Report",
        "report_url": "https://www.enrichanything.com/reports/france-klaviyo-sms-gap",
        "audience": "French retention agencies, email and SMS agencies, Klaviyo consultants, and Shopify lifecycle specialists.",
        "topic": "French Shopify brands that appear to use Klaviyo without visible SMS tooling",
        "prompt": build_retention_prompt(
            "French",
            "French",
            "French Shopify brands that appear to use Klaviyo without visible SMS tooling",
        ),
        "questions": [
            "Why does this gap tend to exist in the French market?",
            "What are the most common false positives?",
            "What would you check before treating this as a real retention opportunity?",
        ],
    },
    {
        "name": "Report comment outreach · German Retention Stack Report",
        "report_label": "German Retention Stack Report",
        "report_url": "https://www.enrichanything.com/reports/germany-klaviyo-sms-gap",
        "audience": "German retention agencies, email and SMS agencies, Klaviyo consultants, and Shopify lifecycle specialists.",
        "topic": "German Shopify brands that appear to use Klaviyo without visible SMS tooling",
        "prompt": build_retention_prompt(
            "German",
            "German",
            "German Shopify brands that appear to use Klaviyo without visible SMS tooling",
        ),
        "questions": [
            "Why does this gap tend to exist in the German market?",
            "What are the most common false positives?",
            "What would you check before treating this as a real retention opportunity?",
        ],
    },
]


def api_request(method, path, payload=None):
    attempts = 6
    for attempt in range(attempts):
        url = f"{BASE_URL}{path}"
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code in {429, 500} and "Too many requests" in body and attempt < attempts - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {path} failed with {error.code}: {body}") from error


def pause_between_configs():
    time.sleep(1.5)


def get_template_graph():
    payload = api_request(
        "GET",
        f"/api/brands/{BRAND_ID}/campaigns/{TEMPLATE_CAMPAIGN_ID}/experiments/{TEMPLATE_RUNTIME_EXPERIMENT_ID}/conversation-map",
    )
    return payload["map"]["publishedGraph"]


def list_experiments():
    payload = api_request("GET", f"/api/brands/{BRAND_ID}/experiments")
    return payload["experiments"]


def upsert_experiment(existing_by_name, config):
    offer = (
        f"We are publishing {config['report_label']}: {config['report_url']}. "
        "We want an expert comment on why the trend exists, what gets misread, and what operators should verify before acting. "
        "CTA: if helpful, I can send the preview and a few questions."
    )
    payload = {
        "name": config["name"],
        "offer": offer,
        "audience": config["audience"],
    }
    existing = existing_by_name.get(config["name"])
    if existing:
        result = api_request(
            "PATCH",
            f"/api/brands/{BRAND_ID}/experiments/{existing['id']}",
            {
                **payload,
                "status": "ready",
            },
        )
        return result["experiment"]
    result = api_request("POST", f"/api/brands/{BRAND_ID}/experiments", payload)
    experiment = result["experiment"]
    ready = api_request(
        "PATCH",
        f"/api/brands/{BRAND_ID}/experiments/{experiment['id']}",
        {"status": "ready"},
    )
    return ready["experiment"]


def build_graph(template_graph, config):
    graph = copy.deepcopy(template_graph)
    start_body = (
        f"Hi {{{{firstName}}}} —\n\n"
        f"We’re preparing a short EnrichAnything report on {config['topic']}, and we plan to share it with our audience shortly.\n\n"
        "Because you work close to this space, I wanted to ask whether you’d be open to commenting on it before it goes out.\n\n"
        "I can send the report preview over, along with a few questions we’d love your take on, so we can quote you in the report as a subject matter expert. "
        "We’d also mention and link back to your agency, brand, or firm in the process."
    )
    question_lines = "\n".join(f"{index}. {question}" for index, question in enumerate(config["questions"], start=1))
    preview_body = (
        f"Thanks — here’s the preview:\n{config['report_url']}\n\n"
        "A few things we’d especially love your take on:\n"
        f"{question_lines}\n\n"
        "If helpful, we’d be glad to quote you in the report as a subject matter expert and mention + link back to your agency, brand, or firm."
    )
    objection_body = (
        "Makes sense.\n\n"
        "I’m not trying to turn this into a pitch. I mainly want a quick expert read before we share the report more broadly.\n\n"
        "If helpful, I can send the preview and a few questions, and you can react async in a couple of lines."
    )
    nudge_body = (
        f"Just following up on the {config['report_label']} in case it’s in your lane.\n\n"
        "Happy to send the preview and a few questions if you’d be open to a quick comment before we publish it. "
        "If we quote you, we’ll mention and link back to your agency, brand, or firm."
    )

    for node in graph["nodes"]:
        title = node.get("title", "")
        if title == "Start question":
            node["subject"] = f"Request for comment on {config['report_label']}"
            node["body"] = start_body
        elif title == "Interest follow-up":
            node["subject"] = f"Preview: {config['report_label']}"
            node["body"] = preview_body
        elif title == "No-reply nudge":
            node["subject"] = f"Follow-up on {config['report_label']}"
            node["body"] = nudge_body
        elif title == "Objection handling":
            node["body"] = objection_body
        elif title == "Question answer":
            node["body"] = (
                "Thanks for the question.\n\n"
                "Short answer: {{shortAnswer}}\n\n"
                "If helpful, I can send the report preview and one or two representative rows so you can judge the pattern quickly."
            )
    return graph


def configure_prospect_table(experiment, config):
    quality_prompt = config["prompt"].strip()
    search_hints = SEARCH_HINTS_BY_REPORT_LABEL.get(config["report_label"], "").strip()
    exclusion_hints = EXCLUSION_HINTS_BY_REPORT_LABEL.get(config["report_label"], "").strip()
    if search_hints:
        quality_prompt = f"{quality_prompt} {search_hints}"
    if exclusion_hints:
        quality_prompt = f"{quality_prompt} {exclusion_hints}"
    quality_prompt = f"{quality_prompt}{AGENCY_QUALITY_SUFFIX}"
    payload = {
        "discoveryPrompt": quality_prompt,
        "discoveryMeta": {
            "promptSource": "custom",
            "reportLabel": config["report_label"],
            "reportUrl": config["report_url"],
            "topic": config["topic"],
            "audience": config["audience"],
            "qualityProfile": "agency_comment_source",
            "questions": config["questions"],
        },
    }
    api_request(
        "PATCH",
        f"/api/brands/{BRAND_ID}/experiments/{experiment['id']}/prospect-table",
        payload,
    )


def configure_conversation_map(experiment, graph):
    campaign_id = experiment["runtime"]["campaignId"]
    runtime_experiment_id = experiment["runtime"]["experimentId"]
    map_name = f"{experiment['name']} Conversation Flow"
    api_request(
        "PATCH",
        f"/api/brands/{BRAND_ID}/campaigns/{campaign_id}/experiments/{runtime_experiment_id}/conversation-map",
        {
            "name": map_name,
            "draftGraph": graph,
        },
    )
    api_request(
        "POST",
        f"/api/brands/{BRAND_ID}/campaigns/{campaign_id}/experiments/{runtime_experiment_id}/conversation-map/publish",
    )


def main():
    experiments = list_experiments()
    existing_by_name = {experiment["name"]: experiment for experiment in experiments}
    template_graph = get_template_graph()
    force_all = "--force-all" in sys.argv[1:]
    flow_only = "--flow-only" in sys.argv[1:]
    prompts_only = "--prompts-only" in sys.argv[1:]
    summary = []
    for config in REPORT_CONFIGS:
        existing = existing_by_name.get(config["name"])
        if (
            existing
            and not force_all
            and existing.get("messageFlow", {}).get("publishedRevision", 0) > 0
            and not prompts_only
            and not flow_only
        ):
            summary.append(
                {
                    "name": config["name"],
                    "experimentId": existing["id"],
                    "campaignId": existing["runtime"]["campaignId"],
                    "runtimeExperimentId": existing["runtime"]["experimentId"],
                    "skipped": True,
                }
            )
            print(f"Skipping {config['name']} ({existing['id']})")
            continue
        experiment = upsert_experiment(existing_by_name, config)
        existing_by_name[config["name"]] = experiment
        if not flow_only:
            configure_prospect_table(experiment, config)
        if not prompts_only:
            graph = build_graph(template_graph, config)
            configure_conversation_map(experiment, graph)
        summary.append(
            {
                "name": config["name"],
                "experimentId": experiment["id"],
                "campaignId": experiment["runtime"]["campaignId"],
                "runtimeExperimentId": experiment["runtime"]["experimentId"],
            }
        )
        print(f"Configured {config['name']} ({experiment['id']})")
        pause_between_configs()
    print(json.dumps({"configured": summary}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
