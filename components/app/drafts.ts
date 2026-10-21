// ร่างบันทึก visit ที่ส่งไม่สำเร็จเพราะเน็ตหลุด (§6.6) — เก็บใน IndexedDB ของเครื่อง แล้วส่งใหม่อัตโนมัติ
// client_uuid ของร่างคือกุญแจกันบันทึกซ้ำฝั่ง server (ส่งซ้ำได้ ไม่เกิดแถวที่สอง)

const DB_NAME = "tb-ppc";
const STORE = "visit-drafts";

export interface VisitDraft {
  client_uuid: string;
  payload: Record<string, unknown>;
  label: string; // ชื่อผู้ป่วย/ผู้สัมผัส ไว้แสดงในรายการรอส่ง
  savedAt: string;
  lastError?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_uuid" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const saveDraft = (d: VisitDraft) => tx("readwrite", (s) => s.put(d));
export const deleteDraft = (uuid: string) => tx("readwrite", (s) => s.delete(uuid));
export async function listDrafts(): Promise<VisitDraft[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    return await tx<VisitDraft[]>("readonly", (s) => s.getAll() as IDBRequest<VisitDraft[]>);
  } catch {
    return [];
  }
}
