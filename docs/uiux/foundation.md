# UI/UX Foundation

## Object Definition
Comment automation queue.

This surface is no longer mainly a one-off manual comment composer. Its core object is a YouTube comment opportunity moving through assignment, drafting, approval, posting, and recovery across many accounts.
## Magic Moment
Operator opens Social Discovery and immediately sees which auto-comment jobs are ready, risky, blocked, or failing. One selected job shows video context, assigned account, GPT draft, and next action. Healthy jobs flow without babysitting; bad jobs are obvious and contain a fix path.
## Technical Constraints
- Web app with async API work and background automation jobs.
- Must support automatic YouTube commenting, not just manual post-by-post use.
- Must orchestrate across roughly 15 YouTube accounts without collapsing into repeated single-account controls.
- Must preserve queue, draft, and assignment context across loading, retries, and partial failures.
- Must expose account-level health and job-level health separately.
- Must support safe retry, pause, reroute, and manual override paths.
- Existing manual search/post flow must remain covered, but no longer own the entire first screen.
## Volume & Density
High density.

This is ops-heavy work: many accounts, many watched channels, many auto-comment opportunities, and many failure/retry states. Default UI should use dense lists/tables plus one focused inspector, not stacked marketing cards.
