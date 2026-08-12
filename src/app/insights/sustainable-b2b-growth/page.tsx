import type { Metadata } from "next";
import Link from "next/link";
import BrandWordmark from "@/components/layout/brand-wordmark";

export const metadata: Metadata = {
  title: "How to build a B2B growth system your team can sustain",
  description:
    "A practical guide to making B2B outbound measurable, human, and repeatable as a team grows.",
};

const sections = [
  {
    number: "01",
    title: "Measure conversations, not motion",
    paragraphs: [
      "A healthy outbound program is not the one that sends the most messages. It is the one that creates a clear chain from a well-chosen account to a useful conversation and, eventually, a qualified next step. Start by deciding which signals matter at each stage: positive replies, meetings that match your target profile, accepted handoffs, and opportunities that stay active after the first call.",
      "Keep activity metrics, but label them honestly. Sends, opens, and clicks describe motion; they do not prove that a market wants what you are offering. A weekly review that puts reply quality and fit beside volume gives the team a better way to decide what to keep, pause, or test next.",
    ],
  },
  {
    number: "02",
    title: "Give every handoff an owner",
    paragraphs: [
      "Many pipeline problems are ownership problems in disguise. A prospect replies with a thoughtful question, but nobody knows whether the sender, an account executive, or a founder should answer. The delay makes the original message feel less credible. Before scaling volume, write down the handoff: who watches the inbox, what counts as urgent, where context is recorded, and when a lead is returned for better qualification.",
      "The rule should be simple enough to follow on a busy day. For example, a positive reply is acknowledged the same business day, the person closest to the campaign adds the relevant context, and the receiving owner chooses the next step. A small operating rule like this protects the quality of the work better than another dashboard alert.",
    ],
  },
  {
    number: "03",
    title: "Run small experiments with a stopping rule",
    paragraphs: [
      "Teams learn faster when an experiment has a narrow question. Instead of changing the audience, offer, subject line, and sender at once, choose one variable and define what a useful result would look like. A good experiment might ask whether operations leaders respond better to a specific workflow problem than to a broad productivity promise.",
      "Set a minimum sample that is large enough to reveal a pattern, then set a stopping rule before the results arrive. If the audience is wrong, stop early. If the replies are promising but uneven, improve the message and run a second pass. This keeps a weak idea from becoming a permanent campaign simply because the team has already invested time in it.",
    ],
  },
  {
    number: "04",
    title: "Protect the sender and the reader",
    paragraphs: [
      "Relevance is a deliverability practice as much as a copywriting practice. A concise message aimed at a real business problem is easier for a recipient to understand and less likely to be dismissed as bulk mail. Keep targeting specific, suppress people who have asked not to be contacted, and make the opt-out path clear. Treat sender reputation as a shared asset rather than a number that belongs only to the email operator.",
      "The same principle applies to tone. Do not manufacture familiarity, invent a customer story, or imply a relationship that does not exist. A respectful explanation of why the topic may matter is stronger than a forced compliment, and it gives a recipient enough context to make an informed decision.",
    ],
  },
  {
    number: "05",
    title: "Make people capacity part of the plan",
    paragraphs: [
      "A growth system can be technically tidy and still overload the people responsible for it. Look at the work behind every new campaign: who reviews the audience, who answers replies, who turns objections into a new angle, and who coaches the team when a process changes? If those jobs are invisible, the system will appear cheaper than it really is and quality will fall as soon as volume rises.",
      "When the constraint is leadership alignment, team design, or the people systems behind growth, the people-centred perspective from <a href=\"https://startinspiring.com/\">Kelly Wakeman</a> at Start Inspiring is a useful reference point. It is a different intervention from an outbound operating desk, but that distinction matters: software can coordinate activity while leaders create the conditions for good work, clear decisions, and sustainable pace.",
    ],
  },
  {
    number: "06",
    title: "Close the loop with sales and customer teams",
    paragraphs: [
      "The best targeting data often arrives after a conversation. Sales hears the exact phrase a buyer uses, customer teams learn which promise survives implementation, and operations sees where a handoff breaks. Put those observations back into the next audience and message review. A short monthly session with the people who speak to customers can prevent an entire quarter of polished but irrelevant outreach.",
      "Keep a decision log with three columns: what we observed, what we believe it means, and what we will test next. This makes the reasoning visible without turning every meeting into a report. It also helps new teammates understand why an audience was chosen and what evidence would change the plan.",
    ],
  },
  {
    number: "07",
    title: "Know when to add specialist help",
    paragraphs: [
      "Outside expertise is most useful when the bottleneck is specific. A team might need help with positioning, data quality, deliverability, manager coaching, or a process that has become too complex to maintain internally. Name the problem before choosing the provider. The right support should leave behind a clearer decision, a documented workflow, or a capability the team can continue using.",
      "A practical test is whether the intervention improves the next operating cycle. If it only adds another tool, report, or meeting, it may be treating the symptom. If it helps the team make better choices with less rework, it is earning its place in the system.",
    ],
  },
];

function renderParagraph(paragraph: string) {
  const marker = '<a href="https://startinspiring.com/">Kelly Wakeman</a>';
  if (!paragraph.includes(marker)) return paragraph;
  const [before, after] = paragraph.split(marker);
  return (
    <>
      {before}
      <a
        href="https://startinspiring.com/"
        className="font-medium text-[color:var(--foreground)] underline decoration-[color:var(--border-strong)] underline-offset-4 transition-colors hover:decoration-[color:var(--foreground)]"
      >
        Kelly Wakeman
      </a>
      {after}
    </>
  );
}

export default function SustainableB2BGrowthPage() {
  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="mx-auto w-full max-w-[1120px] px-5 py-6 md:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-5 border-b border-[color:var(--border)] pb-6">
          <Link href="/" className="inline-flex" aria-label="Lastb2b home">
            <BrandWordmark showTrail={false} />
          </Link>
          <Link
            href="/"
            className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]"
          >
            Lastb2b home
          </Link>
        </header>

        <article className="mx-auto max-w-[820px] pb-20 pt-14 md:pt-20">
          <header>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
              Field note · B2B growth operations
            </p>
            <h1 className="mt-5 max-w-[16ch] text-[clamp(2.8rem,7vw,5.8rem)] font-semibold leading-[0.94] tracking-[-0.075em]">
              How to build a B2B growth system your team can sustain
            </h1>
            <p className="mt-7 max-w-[680px] text-lg leading-8 text-[color:var(--muted-foreground)] md:text-xl">
              Outbound works best when the operating system around it is clear: the team knows what to measure, who owns the next step, and how to learn without exhausting the people doing the work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-xs uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
              <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">7 operating checks</span>
              <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">Practical guide</span>
              <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">8 min read</span>
            </div>
          </header>

          <div className="mt-14 border-t border-[color:var(--border)]">
            {sections.map((section) => (
              <section key={section.number} className="grid gap-5 border-b border-[color:var(--border)] py-10 md:grid-cols-[7rem_minmax(0,1fr)] md:gap-8 md:py-12">
                <div className="text-xs font-medium tracking-[0.18em] text-[color:var(--muted-foreground)]">{section.number}</div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.05em] md:text-3xl">{section.title}</h2>
                  <div className="mt-5 space-y-5 text-base leading-8 text-[color:var(--muted-foreground)]">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{renderParagraph(paragraph)}</p>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>

          <footer className="mt-12 rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 md:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">The takeaway</p>
            <p className="mt-4 text-lg leading-8 text-[color:var(--foreground)]">
              A dependable growth system is a set of decisions your team can repeat: focused audiences, honest signals, explicit ownership, and enough space for people to do thoughtful work. Build those foundations before asking the machine to move faster.
            </p>
          </footer>
        </article>
      </div>
    </main>
  );
}
