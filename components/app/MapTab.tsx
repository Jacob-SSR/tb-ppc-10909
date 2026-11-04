"use client";
// แท็บแผนที่ (admin): หมุดผู้ป่วย · เลือกผู้ป่วย → วง 10/50/200 ม. · ติ้ก "ใครใกล้ผู้ป่วยที่เลือกบ้าง" → รายชื่อรอบบ้าน + วงที่แนะนำ
// → "บันทึกเป็นผู้สัมผัส" เปิดฟอร์มผู้สัมผัสกรอกให้ (ชื่อ เลขบัตร อายุ วง ประเภท) — แบบ pikad-phlapphla-chai / tb-map ใน ppc-hos
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Empty, Input, Select, toast } from "@/components/ui";
import { formatThaiDate } from "@/lib/tb/dates";
import { contactTypeOfRing, formatDistance, nearbyMany, pointOf, RING_LABEL, RING_MAX } from "@/lib/tb/geo";
import type { MapPoint, NearbyPerson } from "@/lib/repo/map";
import { api } from "./api";
import { OutcomeBadge, patientAddress } from "./bits";
import { useApp } from "./store";
import type { Patient } from "./types";

type L = typeof Leaflet;
interface PointsRes { pikad: boolean; residents: number; error: string | null; points: Record<string, MapPoint> }
interface NearbyRes { center: MapPoint; radius: number; error: string | null; people: NearbyPerson[] }

const HOME: [number, number] = [14.72, 103.17]; // อ.พลับพลาชัย
const RADII = [50, 100, 200, 300, 500];
const RING_HEX: Record<1 | 2 | 3, string> = { 1: "#c92a2a", 2: "#e8590c", 3: "#1c7ed6" };
const OUTSIDE_HEX = "#868e96";
const outcomeHex = (o: string | null | undefined) =>
  !o || o === "กำลังรักษา" ? "#c92a2a" : ["หาย", "รักษาครบ"].includes(o) ? "#2b8a3e" : o === "เสียชีวิต" ? "#495057" : "#f08c00";
const BY_LABEL: Record<MapPoint["by"], string> = { db: "พิกัดในทะเบียน", cid: "ชีตประชากร (เลขบัตร)", name: "ชีตประชากร (ชื่อ — ตรวจให้แน่ใจ)" };
const norm = (s: unknown) => String(s ?? "").toLowerCase();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function RingBadge({ ring }: { ring: 1 | 2 | 3 | null }) {
  if (!ring) return <Badge tone="muted">นอกวง</Badge>;
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: RING_HEX[ring] }}>{RING_LABEL[ring]}</span>;
}

export function MapTab() {
  const { data, fy, open, patientById, contactById, contactsOf } = useApp();
  const [pts, setPts] = useState<PointsRes | null>(null);
  const [revision, setRevision] = useState(0);
  const [allYears, setAllYears] = useState(false);
  const [q, setQ] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [radius, setRadius] = useState(200);
  const [showNear, setShowNear] = useState(false);
  const [nearRes, setNearRes] = useState<{ key: string; res?: NearbyRes; err?: string } | null>(null);
  const [onlyNew, setOnlyNew] = useState(true);

  const box = useRef<HTMLDivElement>(null);
  const lib = useRef<L | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const patientLayer = useRef<Leaflet.LayerGroup | null>(null);
  const focusLayer = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  const load = (fresh = false) =>
    api<PointsRes>("GET", `/api/map${fresh ? "?fresh=1" : ""}`).then((res) => {
      setPts(res);
      setRevision((v) => v + 1);
    }).catch((e) => toast(e.message, "bad"));
  useEffect(() => {
    load();
  }, []);

  // สร้างแผนที่ครั้งเดียว (leaflet ใช้ window → import ตอนอยู่บน browser)
  useEffect(() => {
    let dead = false;
    import("leaflet").then((mod) => {
      if (dead || !box.current) return;
      const Lf = (mod as unknown as { default?: L }).default ?? (mod as unknown as L);
      lib.current = Lf;
      const m = Lf.map(box.current, { zoomControl: true }).setView(HOME, 12);
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      patientLayer.current = Lf.layerGroup().addTo(m);
      focusLayer.current = Lf.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const located = useMemo(() => {
    const list = data.patients.filter((p) => allYears || Number(p.fy) === fy);
    const withPt: (Patient & { pt: MapPoint })[] = [];
    const without: Patient[] = [];
    for (const p of list) {
      const pt = pts?.points[p.id] ?? (pointOf(p.lat, p.lng) ? { ...pointOf(p.lat, p.lng)!, by: "db" as const, mapLink: null } : null);
      if (pt) withPt.push({ ...p, pt });
      else without.push(p);
    }
    return { withPt, without };
  }, [data.patients, allYears, fy, pts]);

  const shown = located.withPt.filter((p) => !q || norm(`${p.name} ${p.hn} ${p.area ?? ""}`).includes(norm(q)));
  const selectedPatients = useMemo(() => located.withPt.filter(p => selection.includes(p.id)), [located.withPt, selection]);
  const selected = selectedPatients[0] ?? null;
  const selectedIds = useMemo(() => selectedPatients.map(p => p.id).sort(), [selectedPatients]);
  const sel = selectedIds.join(",");
  function pick(id: string) {
    setSelection(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  // หมุดผู้ป่วย
  useEffect(() => {
    const Lf = lib.current;
    const layer = patientLayer.current;
    if (!ready || !Lf || !layer || !map.current) return;
    layer.clearLayers();
    for (const p of shown) {
      const on = selectedIds.includes(p.id);
      Lf.circleMarker([p.pt.lat, p.pt.lng], {
        radius: on ? 11 : 8, weight: on ? 3 : 2, color: "#fff", fillColor: outcomeHex(p.outcome), fillOpacity: 0.95,
      })
        .bindTooltip(esc(p.name), { direction: "top" })
        .on("click", () => pick(p.id))
        .addTo(layer);
    }
    if (!sel && shown.length) map.current.fitBounds(Lf.latLngBounds(shown.map((p) => [p.pt.lat, p.pt.lng])), { padding: [30, 30], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown.map((p) => `${p.id}:${p.pt.lat}:${p.pt.lng}`).join(), sel]);

  // คนรอบบ้าน (ชีตประชากร) — โหลดใหม่เมื่อเปลี่ยนผู้ป่วย / รัศมี / บันทึกผู้สัมผัสเพิ่ม
  const contactCount = selectedIds.map(id => `${id}:${contactsOf(id).map(c => c.id).sort().join(";")}`).join(",");
  const nearKey = sel && showNear && pts?.pikad ? `${sel}|${radius}|${contactCount}|${revision}` : null;
  useEffect(() => {
    if (!nearKey) return;
    let dead = false;
    const [id, r] = nearKey.split("|");
    api<NearbyRes>("GET", `/api/map/nearby?patients=${id}&radius=${r}`)
      .then((res) => !dead && setNearRes({ key: nearKey, res }))
      .catch((e) => !dead && setNearRes({ key: nearKey, err: e.message }));
    return () => {
      dead = true;
    };
  }, [nearKey]);
  const fresh = nearKey && nearRes?.key === nearKey ? nearRes : null;
  const near = fresh?.res ?? null;
  const nearErr = fresh?.err ?? "";
  const loadingNear = !!nearKey && !fresh;

  // ผู้ป่วยวัณโรครายอื่นในรัศมี (จากทะเบียน — คำนวณในเครื่อง)
  const nearPatients = useMemo(
    () => nearbyMany(selectedPatients.map(p => ({ ...p.pt, id: p.id })), located.withPt.filter(p => !selectedIds.includes(p.id)).map(p => ({ ...p, lat: p.pt.lat, lng: p.pt.lng })), radius, p => p.cid || p.id),
    [selectedPatients, selectedIds, located.withPt, radius],
  );
  const people = (near?.people ?? []).filter((n) => !onlyNew || (!n.contactId && !n.patientId));

  // วงรอบบ้านผู้ป่วยที่เลือก + หมุดคนรอบบ้าน
  useEffect(() => {
    const Lf = lib.current;
    const layer = focusLayer.current;
    if (!ready || !Lf || !layer || !map.current) return;
    layer.clearLayers();
    if (!selectedPatients.length) return;
    for (const patient of selectedPatients) {
      const c: [number, number] = [patient.pt.lat, patient.pt.lng];
      for (const r of [3, 2, 1] as const) {
        if (RING_MAX[r] > radius && r !== 1) continue;
        Lf.circle(c, { radius: RING_MAX[r], color: RING_HEX[r], weight: 2, dashArray: r === 1 ? undefined : "6 6", fillOpacity: r === 1 ? 0.15 : 0.04 }).addTo(layer);
      }
      if (radius > RING_MAX[3]) Lf.circle(c, { radius, color: OUTSIDE_HEX, weight: 1, dashArray: "2 6", fill: false }).addTo(layer);
    }
    if (showNear) {
      for (const n of near?.people ?? []) {
        Lf.circleMarker([n.lat, n.lng], {
          radius: 6, weight: 1.5, color: "#fff", fillColor: n.ring ? RING_HEX[n.ring] : OUTSIDE_HEX, fillOpacity: n.contactId ? 0.4 : 0.9,
        })
          .bindTooltip(`${esc(n.name)} · ${formatDistance(n.distance)}${n.contactId ? " · ผู้สัมผัสแล้ว" : ""}`, { direction: "top" })
          .addTo(layer);
      }
    }
  }, [ready, selectedPatients, radius, showNear, near]);

  // เลื่อนไปบ้านผู้ป่วยเฉพาะตอนเลือก / เปลี่ยนรัศมี (ผลค้นมาทีหลังไม่ดึงแผนที่กลับ)
  const focusAt = selectedPatients.map(p => `${p.pt.lat},${p.pt.lng}`).join(";");
  useEffect(() => {
    if (!ready || !map.current || !focusAt) return;
    const Lf = lib.current;
    if (!Lf) return;
    const bounds = Lf.latLngBounds([]);
    for (const coords of focusAt.split(";")) {
      const [lat, lng] = coords.split(",").map(Number);
      bounds.extend(Lf.latLng(lat, lng).toBounds(radius * 2));
    }
    map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
  }, [ready, focusAt, radius]);

  async function exportPeople() {
    if (!sel || loadingNear || !near || near.error || !people.length) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/map/nearby?patients=${sel}&radius=${radius}&format=xlsx&onlyNew=${onlyNew ? 1 : 0}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || "Export ไม่สำเร็จ");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `คนรอบบ้าน_${selectedPatients.length}คน_รัศมี${radius}ม.xlsx`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(e instanceof Error ? e.message : "Export ไม่สำเร็จ", "bad"); }
    finally { setExporting(false); }
  }

  function record(n: NearbyPerson) {
    const p = patientById(n.centerId);
    if (!p) return;
    const ring = n.ring ?? 3;
    open({
      type: "contact",
      contact: {
        patient_id: p.id, name: n.name, cid: n.cid, age: n.age,
        sex: n.sex === "ชาย" || n.sex === "หญิง" ? n.sex : null, phone: n.phone, ring, contact_type: contactTypeOfRing(ring),
        unit_id: p.unit_id ?? undefined,
        address: n.address || (ring === 1 ? patientAddress(p) || null : null),
        current_address: ring === 1 ? p.current_address ?? null : null,
        notes: `จากแผนที่: ห่างบ้านผู้ป่วย ${formatDistance(n.distance)}${n.nationality ? ` · สัญชาติ ${n.nationality}` : ""}${n.deceased === true ? " · ชีตประชากรระบุว่าเสียชีวิต" : ""}`,
      },
    });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* isolate: z-index ของ Leaflet (400–1000) อยู่แค่ในกล่องนี้ — ไม่ทับ modal (z-50) / แถบแท็บ */}
      <div className="relative isolate z-0">
        <div ref={box} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-2xl border border-line lg:h-[calc(100vh-11rem)]" />
        <div className="pointer-events-none absolute bottom-2 left-2 z-[400] rounded-lg bg-white/90 px-2 py-1 text-xs shadow">
          {selected ? (
            <span className="flex flex-wrap gap-2">
              {([1, 2, 3] as const).map((r) => <span key={r} className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full" style={{ background: RING_HEX[r] }} />{RING_LABEL[r]}</span>)}
            </span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {[["กำลังรักษา", null], ["หาย/รักษาครบ", "หาย"], ["เสียชีวิต", "เสียชีวิต"], ["อื่น ๆ", "ขาดยา"]].map(([l, o]) => (
                <span key={l} className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full" style={{ background: outcomeHex(o) }} />{l}</span>
              ))}
            </span>
          )}
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-3">
        {selectedPatients.length > 0 && (
          <div className="rounded-xl border border-line p-3 text-sm">
            <p className="font-semibold">เลือกแล้ว {selectedPatients.length} คน · เพิ่ม / ลดได้จากรายชื่อหรือหมุด</p>
            <div className="mt-2 flex flex-wrap gap-2">{selectedPatients.map(p => <button key={p.id} onClick={() => pick(p.id)} className="rounded-full border border-brand px-2 py-1">{p.name} ×</button>)}</div>
            <p className="mt-2 text-muted">รวมคนซ้ำแล้ว ใช้ระยะและวงจากผู้ป่วยที่ใกล้ที่สุด</p>
          </div>
        )}
        {selected ? (
          <SelectedPanel
            exporting={exporting} onExport={exportPeople} p={selected} radius={radius} setRadius={setRadius} showNear={showNear} setShowNear={setShowNear}
            pikad={!!pts?.pikad} near={near} nearErr={nearErr} loading={loadingNear} people={people} onlyNew={onlyNew} setOnlyNew={setOnlyNew}
            nearPatients={nearPatients} onBack={() => setSelection([])} onPick={pick} onRecord={record}
            onOpenPatient={(id) => open({ type: "patient", id })}
            onOpenContact={(id) => { const c = contactById(id); if (c) open({ type: "contact", contact: c }); }}
          />
        ) : null}
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="search" placeholder="ค้นหา ชื่อ / HN / ตำบล" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-40 flex-1" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} /> ทุกปีงบ</label>
            </div>
            <p className="text-sm text-muted">
              {allYears ? "ทุกปีงบ" : `ปีงบ ${fy}`}: มีพิกัด {located.withPt.length} ราย{located.without.length ? ` · ไม่มีพิกัด ${located.without.length}` : ""}
              {pts && !pts.pikad && " · ยังไม่ได้เชื่อม ชีตประชากร (PIKAD_SPREADSHEET_ID)"}
              {pts?.pikad && ` · ชีตประชากรที่มีพิกัด ${pts.residents.toLocaleString()} คน`}
              {pts?.pikad && <button className="ml-1 text-brand underline" onClick={() => load(true).then(() => toast("อ่าน ชีตประชากรใหม่แล้ว"))}>อ่านใหม่</button>}
            </p>
            {pts?.error && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">{pts.error}</p>}
            <ul className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto lg:max-h-none">
              {shown.map((p) => (
                <li key={p.id}>
                  <button onClick={() => pick(p.id)} aria-pressed={selectedIds.includes(p.id)} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left hover:border-brand-2 ${selectedIds.includes(p.id) ? "border-brand bg-mint" : "border-line bg-card"}`}>
                    <i className="inline-block size-3 shrink-0 rounded-full" style={{ background: outcomeHex(p.outcome) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted">HN {p.hn || "-"} · {p.area || "-"}{allYears ? ` · ปีงบ ${p.fy}` : ""}</span>
                    </span>
                    <OutcomeBadge outcome={p.outcome} />
                  </button>
                </li>
              ))}
              {!shown.length && <Empty>{pts ? "ไม่มีผู้ป่วยที่มีพิกัด" : "กำลังโหลด…"}</Empty>}
            </ul>
            {located.without.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">ไม่มีพิกัด {located.without.length} ราย (กรอก Latitude/Longitude ในฟอร์มผู้ป่วย)</summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {located.without.map((p) => (
                    <li key={p.id}><button className="text-left text-brand underline" onClick={() => open({ type: "patient", id: p.id })}>{p.name}</button> <span className="text-muted">HN {p.hn || "-"}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </>
      </aside>
    </div>
  );
}

function SelectedPanel(props: {
  exporting: boolean; onExport: () => void;
  p: Patient & { pt: MapPoint }; radius: number; setRadius: (r: number) => void; showNear: boolean; setShowNear: (v: boolean) => void;
  pikad: boolean; near: NearbyRes | null; nearErr: string; loading: boolean; people: NearbyPerson[]; onlyNew: boolean; setOnlyNew: (v: boolean) => void;
  nearPatients: (Patient & { distance: number; ring: 1 | 2 | 3 | null })[];
  onBack: () => void; onPick: (id: string) => void; onRecord: (n: NearbyPerson) => void; onOpenPatient: (id: string) => void; onOpenContact: (id: string) => void;
}) {
  const { p, radius, near } = props;
  const counts = ([1, 2, 3] as const).map((r) => (near?.people ?? []).filter((n) => n.ring === r).length);
  return (
    <>
      <div className="rounded-2xl border border-line bg-card p-3">
        <div className="mb-1 flex items-start gap-2">
          <button onClick={props.onBack} className="rounded-lg border border-line px-2 py-0.5 text-sm" title="กลับไปรายชื่อ">←</button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{p.name}</p>
            <p className="text-xs text-muted">HN {p.hn || "-"} · ปีงบ {p.fy} · เริ่มยา {p.start_date ? formatThaiDate(p.start_date) : "-"}</p>
          </div>
          <OutcomeBadge outcome={p.outcome} />
        </div>
        <p className="text-xs text-muted">{patientAddress(p) || "-"}</p>
        <p className="mt-1 text-xs text-muted">
          พิกัด: {BY_LABEL[p.pt.by]}{" "}
          <a className="text-brand underline" target="_blank" rel="noreferrer" href={p.pt.mapLink || `https://www.google.com/maps?q=${p.pt.lat},${p.pt.lng}`}>Google Maps</a>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => props.onOpenPatient(p.id)}>เปิดหน้าผู้ป่วย</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-brand-2 bg-mint px-3 py-2 font-medium text-brand">
          <input type="checkbox" className="size-5" checked={props.showNear} onChange={(e) => props.setShowNear(e.target.checked)} />
          ใครใกล้ผู้ป่วยที่เลือกบ้าง
        </label>
        <Select className="w-auto" placeholder={false} value={radius} onChange={(e) => props.setRadius(Number(e.target.value))}
          options={RADII.map((r) => ({ value: r, label: `รัศมี ${formatDistance(r)}` }))} />
      </div>

      {props.nearPatients.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold text-bad">ผู้ป่วยวัณโรครายอื่นในรัศมี {props.nearPatients.length} ราย</p>
          <ul className="flex flex-col gap-1">
            {props.nearPatients.map((n) => (
              <li key={n.id} className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-1.5 text-sm">
                <button className="min-w-0 flex-1 truncate text-left font-medium text-brand underline" onClick={() => props.onPick(n.id)}>{n.name}</button>
                <span className="text-muted">{formatDistance(n.distance)}</span>
                <RingBadge ring={n.ring} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {props.showNear && (
        <div className="flex min-h-0 flex-col gap-2">
          {!props.pikad && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">ยังไม่ได้เชื่อม ชีตประชากร — ตั้ง PIKAD_SPREADSHEET_ID ใน .env และแชร์ไฟล์ให้ service account</p>}
          {props.loading && <p className="text-sm text-muted">กำลังหาคนรอบบ้าน…</p>}
          {props.nearErr && <p className="rounded-xl bg-bad-bg p-2 text-sm text-bad">{props.nearErr}</p>}
          {near?.error && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">{near.error}</p>}
          {near && (
            <>
              <p className="text-sm">
                รอบบ้านในรัศมี {formatDistance(radius)}: <b>{near.people.length}</b> คน
                {" · "}วง 1 {counts[0]} · วง 2 {counts[1]} · วง 3 {counts[2]}
              </p>
              <Button size="sm" disabled={props.exporting || props.loading || !!near.error || !props.people.length} onClick={props.onExport}>{props.exporting ? "กำลัง Export…" : "Export Excel (รายชื่อที่แสดง)"}</Button>
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={props.onlyNew} onChange={(e) => props.setOnlyNew(e.target.checked)} /> ซ่อนคนที่บันทึกเป็นผู้สัมผัส / ผู้ป่วยแล้ว
              </label>
              <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto lg:max-h-[calc(100vh-30rem)]">
                {props.people.map((n, i) => (
                  <li key={`${n.cid ?? n.name}-${i}`} className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
                      <span className="whitespace-nowrap text-muted">{formatDistance(n.distance)}</span>
                      <RingBadge ring={n.ring} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>ใกล้ {n.centerName}</span>
                      {n.age != null && <span>อายุ {n.age} ปี</span>}
                      {n.sex && <span>{n.sex}</span>}
                      {n.nationality && <span>สัญชาติ {n.nationality}</span>}
                      <span className={n.deceased === true ? "text-bad" : undefined}>{n.deceased === true ? "เสียชีวิต" : n.deceased === false ? "มีชีวิต" : "ไม่ระบุสถานะชีวิต"}</span>
                      {n.mapLink && <a className="text-brand underline" href={n.mapLink} target="_blank" rel="noreferrer">แผนที่</a>}
                      <span className="flex-1" />
                      {n.contactId ? (
                        <button className="text-contact underline" onClick={() => props.onOpenContact(n.contactId!)}>✓ เป็นผู้สัมผัสแล้ว</button>
                      ) : n.patientId ? (
                        <button className="text-bad underline" onClick={() => props.onOpenPatient(n.patientId!)}>ผู้ป่วยในทะเบียน</button>
                      ) : (
                        <Button size="sm" variant="contact" onClick={() => props.onRecord(n)}>+ บันทึกเป็นผู้สัมผัส</Button>
                      )}
                    </div>
                  </li>
                ))}
                {!props.people.length && <Empty>{props.onlyNew && near.people.length ? "บันทึกครบทุกคนในรัศมีแล้ว" : "ไม่พบใครในรัศมีนี้"}</Empty>}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
