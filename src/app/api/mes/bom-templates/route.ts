import { NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { bomTemplates } = await collections();
  const templates = await bomTemplates.find({}).sort({ processCode: 1 }).toArray();
  return NextResponse.json(templates);
}
