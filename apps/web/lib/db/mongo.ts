import { MongoClient, type Db } from "mongodb"

// Local MongoDB (docker-compose `mongo` service). Server-only — this module is
// only imported by route handlers; the driver pulls in Node built-ins, so any
// accidental client import would fail the build loudly.
const uri =
  process.env.MONGODB_URI ??
  "mongodb://mongo:mongo@localhost:27017/acmebox?authSource=admin"
const dbName = process.env.MONGODB_DB ?? "acmebox"

// Cache the connection *promise* on globalThis so Next.js dev hot-reload reuses
// one pool instead of leaking a fresh MongoClient on every module re-evaluation.
const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>
}

const clientPromise: Promise<MongoClient> =
  globalForMongo._mongoClientPromise ??
  (globalForMongo._mongoClientPromise = new MongoClient(uri).connect())

export async function getDb(): Promise<Db> {
  const client = await clientPromise
  return client.db(dbName)
}
