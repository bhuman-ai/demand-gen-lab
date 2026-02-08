import { NextResponse } from "next/server";
import { readBrands, writeBrands } from "@/lib/brand-storage";

type Brand = {
  id: string;
  website: string;
  brandName: string;
  tone: string;
  targetBuyers: string;
  offers: string;
  proof: string;
  createdAt: string;
  updatedAt?: string;
  modules: {
    strategy: {
      status: "draft" | "active" | "paused";
      goal: string;
      constraints: string;
    };
    sequences: {
      status: "idle" | "testing" | "scaling";
      activeCount: number;
    };
    leads: {
      total: number;
      qualified: number;
    };
  };
  ideas: { title: string; channel: string; rationale: string }[];
  sequences: { name: string; status: string }[];
  leads: { name: string; channel: string; status: string; lastTouch: string }[];
  inbox: { from: string; subject: string; sentiment: string; status: string; receivedAt: string }[];
  domains: { domain: string; status: string; warmupStage: string; reputation: string }[];
};

export async function GET() {
  const brands = (await readBrands()) as Brand[];
  return NextResponse.json({ brands });
}

export async function POST(request: Request) {
  const body = await request.json();
  const website = String(body?.website ?? "").trim();
  const brandName = String(body?.brandName ?? "").trim();

  if (!website || !brandName) {
    return NextResponse.json({ error: "website and brandName are required" }, { status: 400 });
  }

  const brands = (await readBrands()) as Brand[];
  const brand: Brand = {
    id: `brand_${Date.now().toString(36)}`,
    website,
    brandName,
    tone: String(body?.tone ?? ""),
    targetBuyers: String(body?.targetBuyers ?? ""),
    offers: String(body?.offers ?? ""),
    proof: String(body?.proof ?? ""),
    createdAt: new Date().toISOString(),
    modules: {
      strategy: {
        status: "draft",
        goal: "",
        constraints: "",
      },
      sequences: {
        status: "idle",
        activeCount: 0,
      },
      leads: {
        total: 0,
        qualified: 0,
      },
    },
    ideas: [],
    sequences: [],
    leads: [],
    inbox: [],
    domains: [],
  };
  brands.unshift(brand);
  await writeBrands(brands);

  return NextResponse.json({ brand });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const id = String(body?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const brands = (await readBrands()) as Brand[];
  const index = brands.findIndex((brand) => brand.id === id);
  if (index < 0) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const next = { ...brands[index] } as Brand;
  const fields = ["website", "brandName", "tone", "targetBuyers", "offers", "proof"] as const;
  for (const field of fields) {
    if (field in body && typeof body[field] === "string") {
      (next as any)[field] = String(body[field]);
    }
  }
  if (body?.modules && typeof body.modules === "object") {
    next.modules = {
      strategy: {
        status: body.modules?.strategy?.status ?? next.modules.strategy.status,
        goal: String(body.modules?.strategy?.goal ?? next.modules.strategy.goal),
        constraints: String(body.modules?.strategy?.constraints ?? next.modules.strategy.constraints),
      },
      sequences: {
        status: body.modules?.sequences?.status ?? next.modules.sequences.status,
        activeCount:
          typeof body.modules?.sequences?.activeCount === "number"
            ? body.modules.sequences.activeCount
            : next.modules.sequences.activeCount,
      },
      leads: {
        total:
          typeof body.modules?.leads?.total === "number"
            ? body.modules.leads.total
            : next.modules.leads.total,
        qualified:
          typeof body.modules?.leads?.qualified === "number"
            ? body.modules.leads.qualified
            : next.modules.leads.qualified,
      },
    };
  }
  if (Array.isArray(body?.ideas)) {
    next.ideas = body.ideas
      .map((idea: any) => ({
        title: String(idea?.title ?? ""),
        channel: String(idea?.channel ?? ""),
        rationale: String(idea?.rationale ?? ""),
      }))
      .filter((idea: any) => idea.title.length > 0);
  }
  if (Array.isArray(body?.sequences)) {
    next.sequences = body.sequences
      .map((sequence: any) => ({
        name: String(sequence?.name ?? ""),
        status: String(sequence?.status ?? ""),
      }))
      .filter((sequence: any) => sequence.name.length > 0);
  }
  if (Array.isArray(body?.leads)) {
    next.leads = body.leads
      .map((lead: any) => ({
        name: String(lead?.name ?? ""),
        channel: String(lead?.channel ?? ""),
        status: String(lead?.status ?? ""),
        lastTouch: String(lead?.lastTouch ?? ""),
      }))
      .filter((lead: any) => lead.name.length > 0);
  }
  if (Array.isArray(body?.inbox)) {
    next.inbox = body.inbox
      .map((message: any) => ({
        from: String(message?.from ?? ""),
        subject: String(message?.subject ?? ""),
        sentiment: String(message?.sentiment ?? ""),
        status: String(message?.status ?? ""),
        receivedAt: String(message?.receivedAt ?? ""),
      }))
      .filter((message: any) => message.subject.length > 0);
  }
  if (Array.isArray(body?.domains)) {
    next.domains = body.domains
      .map((domain: any) => ({
        domain: String(domain?.domain ?? ""),
        status: String(domain?.status ?? ""),
        warmupStage: String(domain?.warmupStage ?? ""),
        reputation: String(domain?.reputation ?? ""),
      }))
      .filter((domain: any) => domain.domain.length > 0);
  }
  next.updatedAt = new Date().toISOString();
  brands[index] = next;
  await writeBrands(brands);

  return NextResponse.json({ brand: next });
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const id = String(body?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const brands = (await readBrands()) as Brand[];
  const next = brands.filter((brand) => brand.id !== id);
  if (next.length === brands.length) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  await writeBrands(next);

  return NextResponse.json({ deletedId: id });
}
