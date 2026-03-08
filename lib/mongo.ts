import { MongoClient, Collection, Document } from "mongodb";

const uri = process.env.MONGODB_URI!;
const DB_NAME = "donna";

//Types

export interface BusinessCache {
  businessName: string;
  query: string;
  answer: string;
  source: string;
  onlineBookingUrl: string | null;
  timestamp: Date;
}

export interface CallQueueItem {
  businessName: string;
  phone: string;
  scheduledTime: Date;
  status: "pending" | "in-progress" | "done" | "failed";
  userId: string;
  context: {
    task: string;
    timeWindow?: string;
    budget?: string;
  };
  callId?: string;
  createdAt: Date;
}

export interface CallLog {
  callId: string;
  businessName: string;
  transcript: string;
  summary: string;
  booked: boolean;
  bookingTime?: string;
  bookingPrice?: string;
  notes?: string;
  createdAt: Date;
}

//Singleton client — reused across Next.js requests

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

function getClient(): MongoClient {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri, {
      tls: true,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });
  }
  return global._mongoClient;
}

async function getDb() {
  try {
    const client = getClient();
    await client.connect();
    return client.db(DB_NAME);
  } catch (err) {
    // Reset broken singleton so next call gets a fresh client
    global._mongoClient = undefined;
    throw err;
  }
}

//Collection helpers

async function businessCacheCollection(): Promise<Collection<BusinessCache>> {
  const db = await getDb();
  return db.collection<BusinessCache>("business_cache");
}

async function callQueueCollection(): Promise<Collection<CallQueueItem>> {
  const db = await getDb();
  return db.collection<CallQueueItem>("call_queue");
}

async function callLogsCollection(): Promise<Collection<CallLog>> {
  const db = await getDb();
  return db.collection<CallLog>("call_logs");
}

//Cache

export async function getCachedResult(
  businessName: string,
  query: string
): Promise<BusinessCache | null> {
  const col = await businessCacheCollection();
  return col.findOne({ businessName, query });
}

export async function storeResult(
  businessName: string,
  query: string,
  answer: string,
  source: string,
  onlineBookingUrl: string | null = null
): Promise<void> {
  const col = await businessCacheCollection();
  await col.updateOne(
    { businessName, query },
    {
      $set: {
        businessName,
        query,
        answer,
        source,
        onlineBookingUrl,
        timestamp: new Date(),
      },
    },
    { upsert: true }
  );
}

//Call queue

export async function addToQueue(
  item: Omit<CallQueueItem, "status" | "createdAt">
): Promise<void> {
  const col = await callQueueCollection();
  await col.insertOne({
    ...item,
    status: "pending",
    createdAt: new Date(),
  });
}

export async function getOpenJobs(): Promise<CallQueueItem[]> {
  const col = await callQueueCollection();
  return col
    .find({
      status: "pending",
      scheduledTime: { $lte: new Date() },
    })
    .toArray();
}

export async function updateQueueItemStatus(
  businessName: string,
  status: CallQueueItem["status"],
  callId?: string
): Promise<void> {
  const col = await callQueueCollection();
  await col.updateOne(
    { businessName, status: { $in: ["pending", "in-progress"] } },
    { $set: { status, ...(callId ? { callId } : {}) } }
  );
}

//Call logs

export async function storeCallLog(log: Omit<CallLog, "createdAt">): Promise<void> {
  const col = await callLogsCollection();
  await col.updateOne(
    { callId: log.callId },
    { $set: { ...log, createdAt: new Date() } },
    { upsert: true }
  );
}

export async function getCallLog(callId: string): Promise<CallLog | null> {
  const col = await callLogsCollection();
  return col.findOne({ callId });
}
