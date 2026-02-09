import { NextResponse } from "next/server";
import { readBrands, writeBrands } from "@/lib/brand-storage";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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

const TABLE_NAME = "demanddev_brands";

const mapRowToBrand = (row: any): Brand => ({
  id: row.id,
  website: row.website ?? "",
  brandName: row.brand_name ?? "",
  tone: row.tone ?? "",
  targetBuyers: row.target_buyers ?? "",
  offers: row.offers ?? "",
  proof: row.proof ?? "",
  createdAt: row.created_at ?? "",
  updatedAt: row.updated_at ?? "",
  modules: row.modules ?? {
    strategy: { status: "draft", goal: "", constraints: "" },
    sequences: { status: "idle", activeCount: 0 },
    leads: { total: 0, qualified: 0 },
  },
  ideas: row.ideas ?? [],
  sequences: row.sequences ?? [],
  leads: row.leads ?? [],
  inbox: row.inbox ?? [],
  domains: row.domains ?? [],
});

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_NAME).select("*").order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ brands: (data ?? []).map(mapRowToBrand) });
  }

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

  const supabase = getSupabaseAdmin();
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

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert({
        id: brand.id,
        brand_name: brand.brandName,
        website: brand.website,
        tone: brand.tone,
        target_buyers: brand.targetBuyers,
        offers: brand.offers,
        proof: brand.proof,
        modules: brand.modules,
        ideas: brand.ideas,
        sequences: brand.sequences,
        leads: brand.leads,
        inbox: brand.inbox,
        domains: brand.domains,
      })
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ brand: mapRowToBrand(data) });
  }

  const brands = (await readBrands()) as Brand[];
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

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, any> = {};
    if (typeof body?.website === "string") update.website = body.website;
    if (typeof body?.brandName === "string") update.brand_name = body.brandName;
    if (typeof body?.tone === "string") update.tone = body.tone;
    if (typeof body?.targetBuyers === "string") update.target_buyers = body.targetBuyers;
    if (typeof body?.offers === "string") update.offers = body.offers;
    if (typeof body?.proof === "string") update.proof = body.proof;
    if (body?.modules && typeof body.modules === "object") update.modules = body.modules;
    if (Array.isArray(body?.ideas)) update.ideas = body.ideas;
    if (Array.isArray(body?.sequences)) update.sequences = body.sequences;
    if (Array.isArray(body?.leads)) update.leads = body.leads;
    if (Array.isArray(body?.inbox)) update.inbox = body.inbox;
    if (Array.isArray(body?.domains)) update.domains = body.domains;

    const { data, error } = await supabase.from(TABLE_NAME).update(update).eq("id", id).select("*").single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ brand: mapRowToBrand(data) });
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

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from(TABLE_NAME).delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ deletedId: id });
  }

  const brands = (await readBrands()) as Brand[];
  const next = brands.filter((brand) => brand.id !== id);
  if (next.length === brands.length) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  await writeBrands(next);

  return NextResponse.json({ deletedId: id });
}
