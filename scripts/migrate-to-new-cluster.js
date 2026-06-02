require("dotenv").config();
const { MongoClient } = require("mongodb");

const OLD_URI = process.env.OLD_MONGODB_URI;
const NEW_URI = process.env.NEW_MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "dv_workshop_site";
const COLLECTIONS = [
  "app_state",
  "user_sessions",
  "user_preferences",
  "meta_config",
  "meta_logs",
];

async function migrate() {
  if (!OLD_URI || !NEW_URI) {
    throw new Error("Set OLD_MONGODB_URI and NEW_MONGODB_URI before running this migration.");
  }

  const oldClient = new MongoClient(OLD_URI, { serverSelectionTimeoutMS: 15000 });
  const newClient = new MongoClient(NEW_URI, { serverSelectionTimeoutMS: 15000 });

  try {
    console.log("Connecting to OLD cluster...");
    await oldClient.connect();
    console.log("Connecting to NEW cluster...");
    await newClient.connect();

    const oldDb = oldClient.db(DB_NAME);
    const newDb = newClient.db(DB_NAME);

    for (const collName of COLLECTIONS) {
      console.log(`\n--- Migrating collection: ${collName} ---`);
      const oldColl = oldDb.collection(collName);
      const newColl = newDb.collection(collName);

      const docs = await oldColl.find({}).toArray();
      console.log(`  Found ${docs.length} document(s) in old cluster.`);

      if (docs.length === 0) {
        console.log("  Nothing to migrate, skipping.");
        continue;
      }

      // Drop the target collection first to avoid duplicate key errors on re-runs
      await newColl.drop().catch(() => {}); // ignore "ns not found"
      const result = await newColl.insertMany(docs, { ordered: false });
      console.log(`  Inserted ${result.insertedCount} document(s) into new cluster.`);
    }

    console.log("\nMigration complete!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await oldClient.close();
    await newClient.close();
  }
}

migrate();
