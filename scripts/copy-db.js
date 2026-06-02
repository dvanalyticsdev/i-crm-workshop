require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const SOURCE_DB_NAME = process.env.SOURCE_MONGODB_DB_NAME || "dv_workshop_site";
const TARGET_DB_NAME = process.env.TARGET_MONGODB_DB_NAME || process.env.MONGODB_DB_NAME || "i-crm-workshop";

async function copyDatabase() {
  if (!MONGODB_URI) {
    throw new Error("Set MONGODB_URI before running this copy.");
  }

  if (SOURCE_DB_NAME === TARGET_DB_NAME) {
    throw new Error("Source and target database names must be different.");
  }

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  try {
    console.log(`Connecting to MongoDB for ${SOURCE_DB_NAME} -> ${TARGET_DB_NAME}...`);
    await client.connect();

    const sourceDb = client.db(SOURCE_DB_NAME);
    const targetDb = client.db(TARGET_DB_NAME);

    const collections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
    if (!collections.length) {
      throw new Error(`No collections found in source database "${SOURCE_DB_NAME}".`);
    }

    console.log(`Found ${collections.length} collection(s) to copy.`);

    for (const { name } of collections) {
      console.log(`\n--- Copying collection: ${name} ---`);
      const sourceCollection = sourceDb.collection(name);
      const targetCollection = targetDb.collection(name);

      const docs = await sourceCollection.find({}).toArray();
      console.log(`  Found ${docs.length} document(s).`);

      await targetCollection.drop().catch(() => {});

      if (docs.length > 0) {
        const result = await targetCollection.insertMany(docs, { ordered: false });
        console.log(`  Inserted ${result.insertedCount} document(s).`);
      } else {
        await targetDb.createCollection(name).catch(() => {});
        console.log("  Created empty collection.");
      }

      const indexes = await sourceCollection.indexes();
      const nonDefaultIndexes = indexes.filter((index) => index.name !== "_id_");
      if (nonDefaultIndexes.length > 0) {
        await targetCollection.createIndexes(
          nonDefaultIndexes.map(({ key, name: indexName, ...options }) => ({
            key,
            name: indexName,
            ...options,
          }))
        );
        console.log(`  Recreated ${nonDefaultIndexes.length} index(es).`);
      }
    }

    console.log("\nDatabase copy complete.");
  } finally {
    await client.close();
  }
}

copyDatabase().catch((error) => {
  console.error("Database copy failed:", error);
  process.exit(1);
});
