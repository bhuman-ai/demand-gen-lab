import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import BrandWordmark from "@/components/layout/brand-wordmark";
import styles from "./autoads.module.css";

export const metadata: Metadata = {
  title: "AutoAds by Lastb2b",
  description:
    "Public product overview for AutoAds, a Lastb2b feature for keyword discovery, landing page generation, Google Search ad drafts, campaign management, and reporting.",
};

const capabilities = [
  {
    title: "Keyword discovery",
    body: "AutoAds expands a client website and market brief into long-tail commercial search terms that map to buying intent.",
  },
  {
    title: "Keyword scoring",
    body: "Each candidate is scored for intent fit, estimated demand, CPC, and competition so teams can prioritize viable searches.",
  },
  {
    title: "Landing page generation",
    body: "Approved keyword angles are turned into landing page drafts with a generated headline, supporting proof points, and a CTA.",
  },
  {
    title: "Campaign drafts and reporting",
    body: "AutoAds prepares Google Search draft ads, budgets, and ad groups, then syncs campaign reporting back into the Lastb2b dashboard.",
  },
];

const workflow = [
  {
    step: "01",
    title: "Submit website and market",
    body: "An operator or client starts with the website, target geography, and the commercial segment they want to reach.",
  },
  {
    step: "02",
    title: "Research long-tail queries",
    body: "AutoAds discovers keyword candidates tied to real buyer jobs, category language, and high-intent searches.",
  },
  {
    step: "03",
    title: "Score the candidates",
    body: "The system ranks keywords by intent, estimated volume, CPC, and competition so weak ideas can be filtered early.",
  },
  {
    step: "04",
    title: "Generate landing page and ad draft",
    body: "Winning angles become landing page drafts and Google Search ad copy that can be reviewed before launch.",
  },
  {
    step: "05",
    title: "Review reporting in dashboard",
    body: "Clients and operators monitor clicks, conversions, CPC, and sync health from the reporting view inside Lastb2b.",
  },
];

const keywordResearchRows = [
  ["procurement automation software for distributors", "260", "$21.80", "High", "Commercial", "Shortlisted"],
  ["vendor onboarding workflow software", "170", "$18.40", "High", "Commercial", "Draft LP"],
  ["purchase order approval software", "390", "$24.10", "High", "Commercial", "Review"],
  ["b2b spend control platform", "140", "$17.70", "Medium", "Commercial", "Shortlisted"],
  ["accounts payable workflow software", "320", "$19.90", "High", "Commercial", "Ad draft"],
];

const scoringRows = [
  ["procurement automation software for distributors", "92", "$21.80", "0.82", "A", "Reduce PO cycle time"],
  ["vendor onboarding workflow software", "88", "$18.40", "0.74", "A", "Faster supplier onboarding"],
  ["purchase order approval software", "84", "$24.10", "0.79", "B", "Shorten approval chains"],
  ["b2b spend control platform", "80", "$17.70", "0.62", "B", "Control maverick spend"],
];

const apiUses = [
  {
    title: "Keyword planning metrics",
    body: "Lastb2b uses the Google Ads API to pull keyword planning metrics that inform demand, CPC, and competition inside AutoAds.",
  },
  {
    title: "Campaign creation",
    body: "AutoAds turns approved research into Google Search campaign drafts with ad groups, headlines, descriptions, and starting budgets.",
  },
  {
    title: "Campaign updates",
    body: "Operators can revise campaign settings and draft structures as keyword scoring or landing page changes require new ad coverage.",
  },
  {
    title: "Reporting sync",
    body: "Campaign reporting is synchronized back into Lastb2b so operators and clients can review clicks, conversions, CPC, and pacing in one dashboard.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Lastb2b",
      url: "https://lastb2b.com",
      description: "Lastb2b is a B2B software platform for operating growth workflows, campaigns, and client-facing delivery.",
    },
    {
      "@type": "SoftwareApplication",
      name: "AutoAds",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "AutoAds is a feature inside Lastb2b for keyword discovery, keyword scoring, landing page generation, Google Search ad drafts, campaign management, and reporting.",
      publisher: {
        "@type": "Organization",
        name: "Lastb2b",
      },
      isPartOf: {
        "@type": "SoftwareApplication",
        name: "Lastb2b",
      },
      featureList: [
        "Long-tail commercial keyword discovery",
        "Keyword planning metrics and scoring",
        "Landing page generation",
        "Google Search ad draft generation",
        "Campaign management",
        "Campaign reporting",
      ],
    },
  ],
};

function motionStyle(order: number): CSSProperties {
  return { "--motion-order": order } as CSSProperties;
}

function SectionHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.sectionHeader}>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function ScreenFrame({
  title,
  summary,
  label,
  children,
}: {
  title: string;
  summary: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <article className={styles.screenFrame}>
      <div className={styles.screenHeader}>
        <div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
        <div className={styles.screenLabel}>{label}</div>
      </div>
      <div className={styles.screenBody}>{children}</div>
    </article>
  );
}

export default function AutoAdsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.topbarInner}>
            <Link href="/" className={styles.brandLink} aria-label="Lastb2b home">
              <BrandWordmark showTrail={false} />
            </Link>
            <nav className={styles.anchorNav} aria-label="Page sections">
              <a href="#what-it-does">What it does</a>
              <a href="#workflow">How it works</a>
              <a href="#screens">Mock product screens</a>
              <a href="#api-use">Google Ads API use</a>
            </nav>
            <Link href="/" className={styles.appLink}>
              Open Lastb2b
            </Link>
          </div>
        </header>

        <div className={styles.container}>
          <section className={`${styles.hero} motion-enter`} style={motionStyle(0)}>
            <div className={styles.heroCopy}>
              <p className={styles.heroIntro}>
                Lastb2b is a B2B software platform. This page is a public product overview so the AutoAds workflow can be reviewed without logging in.
              </p>
              <h1>AutoAds by Lastb2b</h1>
              <p className={styles.heroLead}>
                A Lastb2b feature that finds buyer-intent keywords, generates landing pages and search ads, and helps clients manage paid search campaigns.
              </p>
              <p className={styles.heroBody}>
                AutoAds is part of Lastb2b, not a separate company. Internal operators use it to prepare search campaigns for clients, and external Lastb2b clients use it to review research, creative drafts, and reporting in the same product workflow.
              </p>
            </div>

            <aside className={styles.heroPanel} aria-label="Product relationship and scope">
              <h2>Product relationship</h2>
              <dl className={styles.factList}>
                <div>
                  <dt>Company</dt>
                  <dd>Lastb2b</dd>
                </div>
                <div>
                  <dt>Feature</dt>
                  <dd>AutoAds inside the Lastb2b platform</dd>
                </div>
                <div>
                  <dt>Users</dt>
                  <dd>Internal operators and external Lastb2b clients</dd>
                </div>
                <div>
                  <dt>Google Ads API</dt>
                  <dd>Keyword planning, campaign creation, campaign management, and reporting</dd>
                </div>
              </dl>
            </aside>
          </section>

          <section id="what-it-does" className={`${styles.section} motion-enter`} style={motionStyle(1)}>
            <SectionHeader
              title="What AutoAds does"
              body="AutoAds is a feature inside Lastb2b that supports the full paid-search workflow from research through reporting."
            />
            <div className={styles.capabilityGrid}>
              {capabilities.map((item) => (
                <article key={item.title} className={styles.capabilityCard}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="workflow" className={`${styles.section} motion-enter`} style={motionStyle(2)}>
            <SectionHeader
              title="How AutoAds works"
              body="The workflow below reflects the product sequence used in Lastb2b when a client needs keyword research, ad creation, and campaign reporting."
            />
            <ol className={styles.workflowList}>
              {workflow.map((item) => (
                <li key={item.step} className={styles.workflowItem}>
                  <div className={styles.workflowStep}>{item.step}</div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="screens" className={`${styles.section} motion-enter`} style={motionStyle(3)}>
            <SectionHeader
              title="Representative product screens"
              body="These are static public mockups of the AutoAds interface. They are published here so reviewers can inspect the UI structure, fields, and outputs without authentication."
            />
            <div className={styles.screenGrid}>
              <ScreenFrame
                title="Keyword research"
                summary="AutoAds starts with the client website and target market, then returns long-tail commercial queries for review."
                label="Discovery workspace"
              >
                <div className={styles.fieldGrid}>
                  <div className={styles.fieldCard}>
                    <span>Client website</span>
                    <strong>clearquota.com</strong>
                  </div>
                  <div className={styles.fieldCard}>
                    <span>Target market</span>
                    <strong>United States / procurement SaaS</strong>
                  </div>
                  <div className={styles.fieldCard}>
                    <span>Research run</span>
                    <strong>Completed · 124 candidates</strong>
                  </div>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Keyword</th>
                        <th>Volume</th>
                        <th>CPC</th>
                        <th>Competition</th>
                        <th>Intent</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keywordResearchRows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell) => (
                            <td key={cell}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ScreenFrame>

              <ScreenFrame
                title="Research controls and candidate scoring"
                summary="Operators can define query families, exclude noise, and score the best candidates before drafting pages and ads."
                label="Scoring workspace"
              >
                <div className={styles.splitLayout}>
                  <div className={styles.controlPane}>
                    <section className={styles.controlSection}>
                      <h4>Query examples</h4>
                      <ul className={styles.inlineList}>
                        <li>procurement automation for distributors</li>
                        <li>vendor onboarding workflow platform</li>
                        <li>purchase order approval software</li>
                      </ul>
                    </section>
                    <section className={styles.controlSection}>
                      <h4>Included seed families</h4>
                      <ul className={styles.inlineList}>
                        <li>procurement automation</li>
                        <li>accounts payable workflows</li>
                        <li>supplier onboarding</li>
                      </ul>
                    </section>
                    <section className={styles.controlSection}>
                      <h4>Excluded terms</h4>
                      <ul className={styles.inlineList}>
                        <li>jobs</li>
                        <li>training</li>
                        <li>free template</li>
                      </ul>
                    </section>
                    <section className={styles.controlMeta}>
                      <div>
                        <span>Locale</span>
                        <strong>en-US</strong>
                      </div>
                      <div>
                        <span>Country</span>
                        <strong>United States</strong>
                      </div>
                      <div>
                        <span>Run status</span>
                        <strong>Scored and ready for drafting</strong>
                      </div>
                    </section>
                  </div>

                  <div className={styles.tableWrap}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>Keyword</th>
                          <th>Intent fit</th>
                          <th>CPC</th>
                          <th>Competition</th>
                          <th>Score</th>
                          <th>LP angle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scoringRows.map((row) => (
                          <tr key={row[0]}>
                            {row.map((cell) => (
                              <td key={cell}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </ScreenFrame>

              <ScreenFrame
                title="Landing page generator"
                summary="Approved keyword angles become landing page drafts with a generated headline, CTA, and a browser preview."
                label="Creative workspace"
              >
                <div className={styles.splitLayout}>
                  <div className={styles.formPane}>
                    <div className={styles.fieldStack}>
                      <span>Keyword angle</span>
                      <strong>Vendor onboarding workflow software</strong>
                    </div>
                    <div className={styles.fieldStack}>
                      <span>Generated headline</span>
                      <strong>Accelerate supplier onboarding without adding manual review work.</strong>
                    </div>
                    <div className={styles.fieldStack}>
                      <span>CTA</span>
                      <strong>Book a workflow audit</strong>
                    </div>
                    <div className={styles.fieldStack}>
                      <span>Proof points</span>
                      <strong>Centralized intake, approval routing, ERP sync, and audit visibility.</strong>
                    </div>
                  </div>

                  <div className={styles.previewPane}>
                    <div className={styles.previewBrowser}>
                      <div className={styles.previewBar}>
                        <span>Landing page preview</span>
                        <span>clearquota.com/vendor-onboarding-workflow</span>
                      </div>
                      <div className={styles.previewCanvas}>
                        <div className={styles.previewNav}>
                          <span>ClearQuota</span>
                          <span>Overview</span>
                          <span>Pricing</span>
                          <span>Book demo</span>
                        </div>
                        <div className={styles.previewHero}>
                          <h4>Stop losing supplier requests in inbox threads.</h4>
                          <p>
                            Auto-generated draft aligned to the keyword angle and ready for client review inside Lastb2b.
                          </p>
                          <div className={styles.previewActions}>
                            <span>Book a workflow audit</span>
                            <span>See onboarding checklist</span>
                          </div>
                        </div>
                        <div className={styles.previewHighlights}>
                          <div>Route approvals by spend tier</div>
                          <div>Capture required supplier documents</div>
                          <div>Sync status into ERP and reporting</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </ScreenFrame>

              <ScreenFrame
                title="Campaign draft and reporting"
                summary="AutoAds assembles Google Search draft ads and syncs campaign reporting back into the Lastb2b dashboard."
                label="Campaign workspace"
              >
                <div className={styles.splitLayout}>
                  <div className={styles.formPane}>
                    <div className={styles.fieldGridTight}>
                      <div className={styles.fieldCard}>
                        <span>Campaign</span>
                        <strong>Procurement automation / US</strong>
                      </div>
                      <div className={styles.fieldCard}>
                        <span>Ad group</span>
                        <strong>Vendor onboarding workflow</strong>
                      </div>
                      <div className={styles.fieldCard}>
                        <span>Budget</span>
                        <strong>$145 / day</strong>
                      </div>
                    </div>

                    <div className={styles.copyBlock}>
                      <h4>Google Search headlines</h4>
                      <ul className={styles.inlineList}>
                        <li>Automate Supplier Onboarding</li>
                        <li>Reduce Manual Approval Delays</li>
                        <li>See Workflow Bottlenecks Faster</li>
                      </ul>
                    </div>

                    <div className={styles.copyBlock}>
                      <h4>Descriptions</h4>
                      <ul className={styles.inlineList}>
                        <li>Centralize onboarding requests, approval routing, and ERP handoff in one workflow.</li>
                        <li>Launch faster with AutoAds research, landing page drafts, and synced reporting in Lastb2b.</li>
                      </ul>
                    </div>
                  </div>

                  <div className={styles.metricsPane}>
                    <div className={styles.metricGrid}>
                      <div className={styles.metricCard}>
                        <span>Clicks</span>
                        <strong>214</strong>
                      </div>
                      <div className={styles.metricCard}>
                        <span>Conversions</span>
                        <strong>19</strong>
                      </div>
                      <div className={styles.metricCard}>
                        <span>Avg. CPC</span>
                        <strong>$12.80</strong>
                      </div>
                      <div className={styles.metricCard}>
                        <span>Spend</span>
                        <strong>$2,739</strong>
                      </div>
                    </div>

                    <div className={styles.tableWrap}>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th>Segment</th>
                            <th>Impr.</th>
                            <th>Clicks</th>
                            <th>Conv.</th>
                            <th>Cost / conv.</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Vendor onboarding workflow</td>
                            <td>10,820</td>
                            <td>142</td>
                            <td>12</td>
                            <td>$138</td>
                          </tr>
                          <tr>
                            <td>Procurement automation</td>
                            <td>7,420</td>
                            <td>72</td>
                            <td>7</td>
                            <td>$154</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </ScreenFrame>
            </div>
          </section>

          <section className={`${styles.section} motion-enter`} style={motionStyle(4)}>
            <SectionHeader
              title="Who uses AutoAds"
              body="AutoAds is used both inside the Lastb2b delivery workflow and by external clients who need visibility into research, drafts, and campaign reporting."
            />
            <div className={styles.audienceGrid}>
              <article className={styles.audienceCard}>
                <h3>Internal operators</h3>
                <p>
                  Lastb2b operators use AutoAds to run keyword research, score candidate searches, generate landing page drafts, prepare Google Search ad drafts, and manage campaign changes.
                </p>
              </article>
              <article className={styles.audienceCard}>
                <h3>External Lastb2b clients</h3>
                <p>
                  Clients use AutoAds inside Lastb2b to review shortlisted keywords, inspect landing page drafts, approve campaign direction, and monitor reporting once campaigns are active.
                </p>
              </article>
            </div>
          </section>

          <section id="api-use" className={`${styles.section} motion-enter`} style={motionStyle(5)}>
            <SectionHeader
              title="Why Lastb2b uses Google Ads API"
              body="The Google Ads API is part of the operational workflow inside AutoAds. The API use is tied directly to research, campaign setup, campaign management, and reporting."
            />
            <div className={styles.capabilityGrid}>
              {apiUses.map((item) => (
                <article key={item.title} className={styles.capabilityCard}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={`${styles.statement} motion-enter`} style={motionStyle(6)}>
            <p>
              Lastb2b is a B2B software platform. AutoAds is a feature inside Lastb2b. Clients use it to find commercial keywords and generate Google Search campaigns. The system provides keyword planning, campaign creation, campaign management, and reporting.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
