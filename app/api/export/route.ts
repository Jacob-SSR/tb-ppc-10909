// GET /api/export?fy=2569|all — ส่งออก Excel (หัวคอลัมน์เดิม, วันที่ พ.ศ.)
// ?template=patient|contact — แบบฟอร์มเปล่าสำหรับนำเข้า
// user unit ได้เฉพาะผู้สัมผัสในเขตตัวเอง (§3); ทุกการส่งออกเขียน audit
import { actorOf } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { buildWorkbook, type ExportSheet } from "@/lib/excel";
import { route } from "@/lib/http";
import { loadAppData } from "@/lib/repo/data";
import { legacyFollowupExtra } from "@/lib/tb/sheetRows";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fileResponse(buf: Buffer, name: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}

export const GET = route(async (req) => {
  const user = await requireUser();
  const actor = actorOf(user, req);
  const sp = new URL(req.url).searchParams;

  const template = sp.get("template");
  if (template === "patient" || template === "contact") {
    const buf = await buildWorkbook([{ name: template === "patient" ? "ผู้ป่วย" : "ผู้สัมผัส", kind: template, rows: [] }], () => "");
    return fileResponse(buf, template === "patient" ? "แบบฟอร์มนำเข้า_ผู้ป่วยTB.xlsx" : "แบบฟอร์มนำเข้า_ผู้สัมผัส.xlsx");
  }

  const fyParam = sp.get("fy");
  const fy = fyParam && fyParam !== "all" ? Number(fyParam) : null;
  const data = await loadAppData(tbDb, actor);
  const units = new Map(data.units.map((u) => [u.id, String(u.name)]));
  const patients = new Map(data.patients.map((p) => [p.id as string, p]));
  const inFy = (p: Record<string, unknown> | undefined) => !fy || (p && Number(p.fy) === fy);

  const sheets: ExportSheet[] = [];
  if (user.role === "admin") {
    const fuBy = new Map<string, { slot: number; result: string | null }[]>();
    for (const f of data.followups) {
      const list = fuBy.get(f.patient_id as string) ?? [];
      list.push({ slot: Number(f.slot), result: f.result as string | null });
      fuBy.set(f.patient_id as string, list);
    }
    sheets.push({
      name: "ผู้ป่วย", kind: "patient",
      rows: data.patients.filter(inFy).map((p) => ({ row: p, extra: legacyFollowupExtra(fuBy.get(p.id as string) ?? []) })),
    });
  }
  sheets.push({
    name: "ผู้สัมผัส", kind: "contact",
    rows: data.contacts
      .filter((c) => inFy(patients.get(c.patient_id as string)))
      .map((c) => {
        const p = patients.get(c.patient_id as string);
        return { row: c, extra: { fy: p?.fy, index_hn: p?.hn } };
      }),
  });
  if (user.role === "admin") {
    sheets.push({ name: "ติดตามระหว่างรักษา", kind: "followup", rows: data.followups.filter((f) => inFy(patients.get(f.patient_id as string))).map((f) => ({ row: f })) });
  }

  const buf = await buildWorkbook(sheets, (id) => units.get(Number(id)) ?? "");
  await writeAudit(tbDb, { userId: user.id, action: "export", entity: "system", changes: { fy: fy ?? "all", sheets: sheets.map((s) => `${s.name} ${s.rows.length}`) }, ip: actor.ip });
  return fileResponse(buf, `TB_${fy ? `ปีงบ${fy}` : "ทุกปีงบ"}_${data.today}.xlsx`);
});
