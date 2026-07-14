import { getDb } from "../src/lib/db";
import type { ProcessMetadataDoc } from "../src/lib/db";

const METADATA: ProcessMetadataDoc[] = [
  { _id: "P01", name: "산화막",       nameEn: "Oxidation",     site: ["이천"],        sequence: 1,  bottleneckRisk: "LOW"    },
  { _id: "P02", name: "CVD",          nameEn: "CVD",           site: ["이천"],        sequence: 2,  bottleneckRisk: "MEDIUM" },
  { _id: "P03", name: "포토",         nameEn: "Photo",         site: ["이천"],        sequence: 3,  bottleneckRisk: "HIGH"   },
  { _id: "P04", name: "식각",         nameEn: "Etching",       site: ["이천"],        sequence: 4,  bottleneckRisk: "HIGH"   },
  { _id: "P05", name: "이온주입",     nameEn: "Ion Implant",   site: ["이천"],        sequence: 5,  bottleneckRisk: "MEDIUM" },
  { _id: "P06", name: "금속배선1",    nameEn: "Metallization", site: ["이천"],        sequence: 6,  bottleneckRisk: "MEDIUM" },
  { _id: "P07", name: "CMP",          nameEn: "CMP",           site: ["이천"],        sequence: 7,  bottleneckRisk: "LOW"    },
  { _id: "P08", name: "TSV/배선2",    nameEn: "TSV/Metal2",    site: ["이천"],        sequence: 8,  bottleneckRisk: "HIGH"   },
  { _id: "P09", name: "웨이퍼테스트", nameEn: "Wafer Test",    site: ["이천", "청주"], sequence: 9,  bottleneckRisk: "LOW"    },
  { _id: "P10", name: "패키징",       nameEn: "Packaging",     site: ["이천", "청주"], sequence: 10, bottleneckRisk: "LOW"    },
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
