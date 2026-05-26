# IA & Flows

## Technical Sitemap
- Brand GPT / Agent home (default)
  - Chat with brand-scoped AI operator
  - Agent activity feed
  - Attention requests and evidence receipts
  - Details panel for brand context, delivery account, connected tools, and advanced links
- Inbox
  - Prospect replies
  - Drafts and follow-ups
  - Reply quality/evaluation
- Audience
  - Leads and accounts
  - Sourcing and enrichment
  - Prospect import/review
- Delivery
  - Senders, domains, DNS, warmup, inbox placement, and routing
  - Customer.io/Mailpool/Gmail UI/provider health
- Outbound
  - Production campaigns and graduated sends
  - Live run state and performance
- Tests
  - Messaging experiments and variants
  - Conversation flow and launch prep
- Social
  - Social discovery and comment opportunities
  - Account/channel operations
- Settings & Diagnostics
  - Provider credentials, provisioning, system health, debug/doctor/logic tools
## Psychological Sitemap
- Default state answers: what is Brand GPT doing, what does it need, and can I trust it?
- The agent is first because the product promise is autonomy, not manual campaign management.
- Inbox, Audience, Delivery, Outbound, Tests, and Social are drilldowns for inspection and intervention.
- Healthy automation should recede into short activity/evidence rows.
- Blockers should appear as one plain-English issue with a suggested next reply/action.
- Internal tool names, provider state, and raw logs should be available but not visually equal to the user's next decision.
- Navigation should feel like one workspace, not a list of unrelated growth tools.
## Navigation Paradigm
Agent home with drilldowns. The persistent sidebar should put Brand GPT first, then the core support surfaces: Inbox, Audience, Delivery. More detailed work surfaces such as Outbound, Tests, and Social can live behind a secondary group. System-only areas such as Settings, Diagnostics, and Logic stay visually secondary.
## Happy Paths
1. Start a brand: user enters site and target customers -> Brand GPT builds context -> agent proposes first moves -> user edits only what is wrong.
2. Let the agent work: Brand GPT sources leads, tests copy, checks delivery, sends safe batches, watches replies, and logs evidence.
3. Resolve a blocker: agent asks for attention -> user answers in chat or opens the relevant drilldown -> agent continues.
4. Inspect proof: user opens Activity/Evidence/Delivery/Inbox to see exactly what happened without leaving the brand context.
5. Manual intervention: user opens a drilldown, changes sender/context/lead/reply state, then returns to Brand GPT as the home base.
