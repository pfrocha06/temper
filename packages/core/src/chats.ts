import { asc, desc, eq } from "drizzle-orm";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { chatMessages, chats } from "./db/schema.ts";
import { newId } from "./ids.ts";
import { redact } from "./redact.ts";

export type Chat = typeof chats.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

export async function createChat(db: Db, environmentId: string, title: string): Promise<Chat> {
  const [row] = await db.insert(chats).values({ id: newId("chat"), environmentId, title }).returning();
  await audit(db, { actor: "board", kind: "chat.started", subject: row!.id, data: { title } });
  return row!;
}

export async function listChats(db: Db, environmentId?: string): Promise<Chat[]> {
  const q = db.select().from(chats);
  return (environmentId ? q.where(eq(chats.environmentId, environmentId)) : q).orderBy(desc(chats.updatedAt));
}

export async function getChat(db: Db, id: string): Promise<Chat | undefined> {
  const [row] = await db.select().from(chats).where(eq(chats.id, id));
  return row;
}

export async function chatHistory(db: Db, chatId: string): Promise<ChatMessage[]> {
  return db.select().from(chatMessages).where(eq(chatMessages.chatId, chatId)).orderBy(asc(chatMessages.id));
}

export async function addChatMessage(
  db: Db,
  chatId: string,
  author: "board" | "chief",
  content: string,
  actions: ChatMessage["actions"] = [],
  sessionId?: string,
): Promise<ChatMessage> {
  const [row] = await db.insert(chatMessages).values({ chatId, author, content: redact(content), actions }).returning();
  await db
    .update(chats)
    .set({ updatedAt: new Date(), ...(sessionId ? { sessionId } : {}) })
    .where(eq(chats.id, chatId));
  return row!;
}
