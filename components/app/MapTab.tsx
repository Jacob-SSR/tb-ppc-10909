"use client";
// แท็บแผนที่ (admin): หมุดผู้ป่วย · เลือกผู้ป่วย → วง 10/50/200 ม. · ติ้ก "ใครใกล้คนนี้บ้าง" → รายชื่อรอบบ้าน + วงที่แนะนำ
// → "บันทึกเป็นผู้สัมผัส" เปิดฟอร์มผู้สัมผัสกรอกให้ (ชื่อ เลขบัตร อายุ วง ประเภท) — แบบ pikad-phlapphla-chai / tb-map ใน ppc-hos
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Empty, Input, Select, toast } from "@/components/ui";
import { formatThaiDate } from "@/lib/tb/dates";
import { contactTypeOfRing, formatDistance, nearby, pointOf, RING_LABEL, RING_MAX } from "@/lib/tb/geo";
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
const BY_LABEL: Record<MapPoint["by"], string> = { db: "พิกัดในทะเบียน", cid: "Sheet พิกัดบ้าน (เลขบัตร)", name: "Sheet พิกัดบ้าน (ชื่อ — ตรวจให้แน่ใจ)" };
const norm = (s: unknown) => String(s ?? "").toLowerCase();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function RingBadge({ ring }: { ring: 1 | 2 | 3 | null }) {
  if (!ring) return <Badge tone="muted">นอกวง</Badge>;
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: RING_HEX[ring] }}>{RING_LABEL[ring]}</span>;
}

export function MapTab() {
  const { data, fy, open, patientById, contactById, contactsOf } = useApp();
  const [pts, setPts] = useState<PointsRes | null>(null);
  const [allYears, setAllYears] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
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
    api<PointsRes>("GET", `/api/map${fresh ? "?fresh=1" : ""}`).then(setPts).catch((e) => toast(e.message, "bad"));
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
  const selected = sel ? located.withPt.find((p) => p.id === sel) ?? null : null;

  // หมุดผู้ป่วย
  useEffect(() => {
    const Lf = lib.current;
    const layer = patientLayer.current;
    if (!ready || !Lf || !layer || !map.current) return;
    layer.clearLayers();
    for (const p of shown) {
      const on = p.id === sel;
      Lf.circleMarker([p.pt.lat, p.pt.lng], {
        radius: on ? 11 : 8, weight: on ? 3 : 2, color: "#fff", fillColor: outcomeHex(p.outcome), fillOpacity: 0.95,
      })
        .bindTooltip(esc(p.name), { direction: "top" })
        .on("click", () => setSel(p.id))
        .addTo(layer);
    }
    if (!sel && shown.length) map.current.fitBounds(Lf.latLngBounds(shown.map((p) => [p.pt.lat, p.pt.lng])), { padding: [30, 30], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown.map((p) => p.id).join(), sel]);

  // คนรอบบ้าน (Sheet พิกัดบ้าน) — โหลดใหม่เมื่อเปลี่ยนผู้ป่วย / รัศมี / บันทึกผู้สัมผัสเพิ่ม
  const contactCount = sel ? contactsOf(sel).length : 0;
  const nearKey = sel && showNear && pts?.pikad ? `${sel}|${radius}|${contactCount}` : null;
  useEffect(() => {
    if (!nearKey) return;
    let dead = false;
    const [id, r] = nearKey.split("|");
    api<NearbyRes>("GET", `/api/map/nearby?patient=${id}&radius=${r}`)
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
    () => (selected ? nearby(selected.pt, located.withPt.filter((p) => p.id !== selected.id).map((p) => ({ ...p, lat: p.pt.lat, lng: p.pt.lng })), radius) : []),
    [selected, located.withPt, radius],
  );
  const people = (near?.people ?? []).filter((n) => !onlyNew || (!n.contactId && !n.patientId));

  // วงรอบบ้านผู้ป่วยที่เลือก + หมุดคนรอบบ้าน
  useEffect(() => {
    const Lf = lib.current;
    const layer = focusLayer.current;
    if (!ready || !Lf || !layer || !map.current) return;
    layer.clearLayers();
    if (!selected) return;
    const c: [number, number] = [selected.pt.lat, selected.pt.lng];
    for (const r of [3, 2, 1] as const) {
      if (RING_MAX[r] > radius && r !== 1) continue;
      Lf.circle(c, { radius: RING_MAX[r], color: RING_HEX[r], weight: 2, dashArray: r === 1 ? undefined : "6 6", fillOpacity: r === 1 ? 0.15 : 0.04 }).addTo(layer);
    }
    if (radius > RING_MAX[3]) Lf.circle(c, { radius, color: OUTSIDE_HEX, weight: 1, dashArray: "2 6", fill: false }).addTo(layer);
    if (showNear) {
      for (const n of near?.people ?? []) {
        Lf.circleMarker([n.lat, n.lng], {
          radius: 6, weight: 1.5, color: "#fff", fillColor: n.ring ? RING_HEX[n.ring] : OUTSIDE_HEX, fillOpacity: n.contactId ? 0.4 : 0.9,
        })
          .bindTooltip(`${esc(n.name)} · ${formatDistance(n.distance)}${n.contactId ? " · ผู้สัมผัสแล้ว" : ""}`, { direction: "top" })
          .addTo(layer);
      }
    }
  }, [ready, selected, radius, showNear, near]);

  // เลื่อนไปบ้านผู้ป่วยเฉพาะตอนเลือก / เปลี่ยนรัศมี (ผลค้นมาทีหลังไม่ดึงแผนที่กลับ)
  const focusAt = selected ? `${selected.pt.lat},${selected.pt.lng}` : null;
  useEffect(() => {
    if (!ready || !map.current || !focusAt) return;
    const [lat, lng] = focusAt.split(",").map(Number);
    map.current.flyTo([lat, lng], radius > 200 ? 16 : 17, { duration: 0.6 });
  }, [ready, focusAt, radius]);

  function record(n: NearbyPerson) {
    const p = patientById(sel);
    if (!p) return;
    const ring = n.ring ?? 3;
    open({
      type: "contact",
      contact: {
        patient_id: p.id, name: n.name, cid: n.cid, age: n.age, ring, contact_type: contactTypeOfRing(ring),
        unit_id: p.unit_id ?? undefined,
        address: ring === 1 ? patientAddress(p) || null : null,
        current_address: ring === 1 ? p.current_address ?? null : null,
        notes: `จากแผนที่: ห่างบ้านผู้ป่วย ${formatDistance(n.distance)}`,
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
        {selected ? (
          <SelectedPanel
            p={selected} radius={radius} setRadius={setRadius} showNear={showNear} setShowNear={setShowNear}
            pikad={!!pts?.pikad} near={near} nearErr={nearErr} loading={loadingNear} people={people} onlyNew={onlyNew} setOnlyNew={setOnlyNew}
            nearPatients={nearPatients} onBack={() => setSel(null)} onPick={setSel} onRecord={record}
            onOpenPatient={(id) => open({ type: "patient", id })}
            onOpenContact={(id) => { const c = contactById(id); if (c) open({ type: "contact", contact: c }); }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="search" placeholder="ค้นหา ชื่อ / HN / ตำบล" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-40 flex-1" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} /> ทุกปีงบ</label>
            </div>
            <p className="text-sm text-muted">
              {allYears ? "ทุกปีงบ" : `ปีงบ ${fy}`}: มีพิกัด {located.withPt.length} ราย{located.without.length ? ` · ไม่มีพิกัด ${located.without.length}` : ""}
              {pts && !pts.pikad && " · ยังไม่ได้เชื่อม Sheet พิกัดบ้าน (PIKAD_SPREADSHEET_ID)"}
              {pts?.pikad && ` · Sheet พิกัดบ้าน ${pts.residents.toLocaleString()} หลัง`}
              {pts?.pikad && <button className="ml-1 text-brand underline" onClick={() => load(true).then(() => toast("อ่าน Sheet พิกัดบ้านใหม่แล้ว"))}>อ่านใหม่</button>}
            </p>
            {pts?.error && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">{pts.error}</p>}
            <ul className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto lg:max-h-none">
              {shown.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSel(p.id)} className="flex w-full items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-left hover:border-brand-2">
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
        )}
      </aside>
    </div>
  );
}

function SelectedPanel(props: {
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
          ใครใกล้คนนี้บ้าง
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
          {!props.pikad && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">ยังไม่ได้เชื่อม Sheet พิกัดบ้าน — ตั้ง PIKAD_SPREADSHEET_ID ใน .env และแชร์ไฟล์ให้ service account</p>}
          {props.loading && <p className="text-sm text-muted">กำลังหาคนรอบบ้าน…</p>}
          {props.nearErr && <p className="rounded-xl bg-bad-bg p-2 text-sm text-bad">{props.nearErr}</p>}
          {near?.error && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">{near.error}</p>}
          {near && (
            <>
              <p className="text-sm">
                รอบบ้านในรัศมี {formatDistance(radius)}: <b>{near.people.length}</b> คน
                {" · "}วง 1 {counts[0]} · วง 2 {counts[1]} · วง 3 {counts[2]}
              </p>
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
                      {n.age != null && <span>อายุ {n.age} ปี</span>}
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
