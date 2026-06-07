import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import styles from "./liftline.module.css";

export const metadata: Metadata = {
  title: {
    absolute: "Liftline | Instagram Growth Desk",
  },
  description:
    "Liftline helps brands find timely Instagram posts, review useful comments, and post only when account health is clear.",
};

const APP_PREVIEW_HREF = "/brands/demo/instagram-growth";

const steps = [
  {
    title: "Find the right moment",
    body: "Surface posts where your brand can add something useful instead of chasing every mention.",
    icon: Search,
  },
  {
    title: "Approve the comment",
    body: "Edit the suggested reply, keep the tone human, and make the final call before anything goes out.",
    icon: MessageSquareText,
  },
  {
    title: "Protect the account",
    body: "Cooldowns, recent activity, and review notes stay visible so growth never turns into blind posting.",
    icon: ShieldCheck,
  },
];

const productRows = [
  ["Ready", "Founder asks for skincare routines", "Fit 92 / Timing 86"],
  ["Needs edit", "Creator compares travel bags", "Tone note attached"],
  ["Posted", "Customer shares studio setup", "Comment accepted"],
];

const nameOptions = [
  {
    name: "Liftline",
    note: "Chosen. Short, growth-oriented, and still implies a controlled queue.",
  },
  {
    name: "Reachline",
    note: "Clear, but more generic and closer to basic outreach language.",
  },
  {
    name: "Momentdesk",
    note: "Good for timing, slightly more internal-tool than customer-facing SaaS.",
  },
  {
    name: "Replywell",
    note: "Trustworthy, but narrower than the full discovery and health workflow.",
  },
  {
    name: "Signalpost",
    note: "Strong on discovery, less direct about approving useful comments.",
  },
];

export default function LiftlineHomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <header className={styles.nav}>
          <Link href="/liftline" className={styles.brand} aria-label="Liftline home">
            <span className={styles.brandMark}>L</span>
            <span>Liftline</span>
          </Link>
          <nav className={styles.navLinks} aria-label="Homepage sections">
            <a href="#workflow">Workflow</a>
            <a href="#product">Product</a>
            <a href="#names">Names</a>
          </nav>
          <Link href={APP_PREVIEW_HREF} className={styles.navCta}>
            Open app
          </Link>
        </header>

        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1>Liftline</h1>
            <p className={styles.heroLead}>
              Find Instagram posts worth answering, approve one useful comment, and grow without handing your brand to a bot.
            </p>
            <div className={styles.heroActions}>
              <Link href={APP_PREVIEW_HREF} className={styles.primaryButton}>
                Open product preview
                <ArrowRight className={styles.buttonIcon} />
              </Link>
              <a href="#workflow" className={styles.secondaryButton}>
                See workflow
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.proofStrip} aria-label="Product principles">
        <div>
          <CheckCircle2 className={styles.stripIcon} />
          Manual approval before posting
        </div>
        <div>
          <Clock3 className={styles.stripIcon} />
          Cooldowns and account health visible
        </div>
        <div>
          <Sparkles className={styles.stripIcon} />
          Built around useful comments, not spam
        </div>
      </section>

      <section id="workflow" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>A growth desk for comments that should exist.</h2>
          <p>
            Liftline is not an auto-comment cannon. It is a review surface for finding the moments where your brand can
            add context, answer a question, or join a relevant conversation.
          </p>
        </div>
        <div className={styles.stepGrid}>
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className={styles.stepCard}>
                <Icon className={styles.stepIcon} />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="product" className={styles.productSection}>
        <div className={styles.productCopy}>
          <h2>The homepage sells the workflow. The app keeps the guardrails.</h2>
          <p>
            Buyers should understand the promise before they see the console: source the right posts, review the draft,
            check account health, then post only when it makes sense.
          </p>
          <Link href={APP_PREVIEW_HREF} className={styles.inlineLink}>
            Open the current desk
            <ArrowRight className={styles.linkIcon} />
          </Link>
        </div>

        <div className={styles.previewPanel} aria-label="Liftline product preview">
          <div className={styles.previewTop}>
            <div>
              <strong>Today&apos;s review line</strong>
              <span>3 opportunities waiting</span>
            </div>
            <span className={styles.previewStatus}>Healthy account</span>
          </div>
          <div className={styles.previewRows}>
            {productRows.map((row) => (
              <div key={row[1]} className={styles.previewRow}>
                <span>{row[0]}</span>
                <strong>{row[1]}</strong>
                <small>{row[2]}</small>
              </div>
            ))}
          </div>
          <div className={styles.commentDraft}>
            <span>Approved comment</span>
            <p>
              Helpful angle. We see teams handle this best when the first reply names the tradeoff, not the product.
            </p>
            <button type="button">Post approved comment</button>
          </div>
        </div>
      </section>

      <section id="names" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Better name direction</h2>
          <p>
            I would ship the first standalone pass as Liftline. The alternatives below are useful if you want the brand
            to lean more toward replies, timing, or discovery.
          </p>
        </div>
        <div className={styles.nameGrid}>
          {nameOptions.map((option) => (
            <article key={option.name} className={option.name === "Liftline" ? styles.nameChosen : styles.nameCard}>
              <h3>{option.name}</h3>
              <p>{option.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <h2>Start with the desk. Market it as the safer way to grow.</h2>
          <p>One queue, one comment, one account-health check before posting.</p>
        </div>
        <Link href={APP_PREVIEW_HREF} className={styles.primaryButton}>
          Open Liftline
          <ArrowRight className={styles.buttonIcon} />
        </Link>
      </section>
    </main>
  );
}
