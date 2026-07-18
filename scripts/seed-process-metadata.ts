import { getDb } from "../src/lib/db";
import type { ProcessMetadataDoc } from "../src/lib/db";

const METADATA: ProcessMetadataDoc[] = [
  { _id: "P01", name: "산화막",       nameEn: "Oxidation",     sequence: 1,  bottleneckRisk: "LOW"    },
  { _id: "P02", name: "CVD",          nameEn: "CVD",           sequence: 2,  bottleneckRisk: "MEDIUM" },
  { _id: "P03", name: "포토",         nameEn: "Photo",         sequence: 3,  bottleneckRisk: "HIGH"   },
  { _id: "P04", name: "식각",         nameEn: "Etching",       sequence: 4,  bottleneckRisk: "HIGH"   },
  { _id: "P05", name: "이온주입",     nameEn: "Ion Implant",   sequence: 5,  bottleneckRisk: "MEDIUM" },
  { _id: "P06", name: "금속배선1",    nameEn: "Metallization", sequence: 6,  bottleneckRisk: "MEDIUM" },
  { _id: "P07", name: "CMP",          nameEn: "CMP",           sequence: 7,  bottleneckRisk: "LOW"    },
  { _id: "P08", name: "TSV/배선2",    nameEn: "TSV/Metal2",    sequence: 8,  bottleneckRisk: "HIGH"   },
  { _id: "P09", name: "웨이퍼테스트", nameEn: "Wafer Test",    sequence: 9,  bottleneckRisk: "LOW"    },
  { _id: "P10", name: "패키징",       nameEn: "Packaging",     sequence: 10, bottleneckRisk: "LOW"    },
];

async function main() {
  const db = await getDb();
  const col = db.collection<ProcessMetadataDoc>("processMetadata");
  let count = 0;
  for (const doc of METADATA) {
    await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
    count++;
  }
  console.log(`Upserted ${count} processMetadata documents`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
