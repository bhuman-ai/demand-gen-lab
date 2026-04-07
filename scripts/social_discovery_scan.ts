import { getBrandById, listBrands } from "@/lib/factory-data";
import { discoverSocialPostsForBrand, parseSocialDiscoveryPlatforms } from "@/lib/social-discovery";
import { createSocialDiscoveryRun, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";

type CliOptions = {
  brandId: string;
  provider: "auto" | "exa" | "dataforseo";
  platforms: string;
  terms: string;
  subreddits: string;
  limit: number;
  maxQueries: number;
};

function usage() {
  return [
    "Usage:",
    "  npx tsx scripts/social_discovery_scan.ts --brand <brand_id> [--provider exa|dataforseo|auto] [--platforms reddit,instagram] [--terms competitorA,competitorB] [--subreddits startups,SaaS]",
    "",
    "Environment:",
    "  Exa: EXA_API_KEY",
    "  DataForSEO: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    brandId: "",
    provider: "auto",
    platforms: "reddit,instagram",
    terms: "",
    subreddits: "",
    limit: 25,
    maxQueries: 12,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? "";
    };
    switch (arg) {
      case "--brand":
      case "--brand-id":
        options.brandId = next().trim();
        break;
      case "--platform":
      case "--platforms":
        options.platforms = next().trim();
        break;
      case "--provider": {
        const value = next().trim().toLowerCase();
        if (value === "exa" || value === "dataforseo" || value === "auto") {
          options.provider = value;
          break;
        }
        throw new Error("--provider must be auto, exa, or dataforseo");
      }
      case "--terms":
      case "--extra-terms":
        options.terms = next().trim();
        break;
      case "--subreddit":
      case "--subreddits":
        options.subreddits = next().trim();
        break;
      case "--limit":
        options.limit = Math.max(1, Math.min(100, Number(next()) || options.limit));
        break;
      case "--max-queries":
        options.maxQueries = Math.max(1, Math.min(40, Number(next()) || options.maxQueries));
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function resolveBrand(brandId: string) {
  if (brandId) return getBrandById(brandId);
  const brands = await listBrands();
  return brands[0] ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const brand = await resolveBrand(options.brandId);
  if (!brand) {
    throw new Error(options.brandId ? `Brand not found: ${options.brandId}` : "No brands found.");
  }

  const startedAt = new Date().toISOString();
  const discovery = await discoverSocialPostsForBrand({
    brand,
    provider: options.provider,
    platforms: parseSocialDiscoveryPlatforms(options.platforms),
    extraTerms: splitCsv(options.terms),
    subreddits: splitCsv(options.subreddits),
    limitPerQuery: options.limit,
    maxQueries: options.maxQueries,
  });
  const savedPosts = await saveSocialDiscoveryPosts(discovery.posts);
  const run = await createSocialDiscoveryRun({
    brandId: brand.id,
    provider: discovery.provider,
    platforms: discovery.platforms,
    queries: discovery.queries,
    postIds: savedPosts.map((post) => post.id),
    errorCount: discovery.errors.length,
    errors: discovery.errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      {
        runId: run.id,
        brandId: brand.id,
        brandName: brand.name,
        platforms: discovery.platforms,
        provider: discovery.provider,
        queries: discovery.queries.length,
        found: discovery.posts.length,
        saved: savedPosts.length,
        errors: discovery.errors,
        topPosts: savedPosts
          .slice()
          .sort((left, right) => right.risingScore - left.risingScore)
          .slice(0, 10)
          .map((post) => ({
            platform: post.platform,
            risingScore: post.risingScore,
            relevanceScore: post.relevanceScore,
            intent: post.intent,
            title: post.title,
            url: post.url,
            interaction: post.interactionPlan.headline,
            assetNeeded: post.interactionPlan.assetNeeded,
          })),
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Social discovery scan failed");
  process.exit(1);
});
