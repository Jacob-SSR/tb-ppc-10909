"use client";
// แท็บแผนที่ (admin): หมุดผู้ป่วย · เลือกผู้ป่วย → วง 10/50/200 ม. · ติ้ก "ใครใกล้คนนี้บ้าง" → รายชื่อรอบบ้าน + วงที่แนะนำ
// → "บันทึกเป็นผู้สัมผัส" เปิดฟอร์มผู้สัมผัสกรอกให้ (ชื่อ เลขบัตร อายุ วง ประเภท) — แบบ pikad-phlapphla-chai / tb-map ใน ppc-hos
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Empty, Input, Select, toast } from "@/components/ui";
import { formatThaiDate } from "@/lib/tb/dates";
import { hospitalDirections } from "@/lib/tb/mapLinks";
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
const BY_LABEL: Record<MapPoint["by"], string> = { db: "พิกัดในทะเบียน", cid: "ชีตประชากร (เลขบัตร)", name: "ชีตประชากร (ชื่อ — ตรวจให้แน่ใจ)" };
const norm = (s: unknown) => String(s ?? "").toLowerCase();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const personKey = (n: NearbyPerson) => `${n.cid ?? n.name}|${n.lat}|${n.lng}`;

function RingBadge({ ring }: { ring: 1 | 2 | 3 | null }) {
  if (!ring) return <Badge tone="muted">นอกวง</Badge>;
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: RING_HEX[ring] }}>{RING_LABEL[ring]}</span>;
}

function DirectionsLink({ point, name, primary = false }: { point: { lat: number; lng: number }; name: string; primary?: boolean }) {
  return <a href={hospitalDirections(point)} target="_blank" rel="noreferrer"
    aria-label={`เปิดเส้นทางจากโรงพยาบาลพลับพลาชัยไปบ้าน ${name} ใน Google Maps`}
    title="เส้นทางขับรถจากโรงพยาบาลพลับพลาชัยไปบ้าน · เปิด Google Maps"
    className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${primary ? "bg-brand text-white hover:bg-brand/90" : "border border-line bg-white text-brand hover:bg-mint"}`}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3 9 9-9 9-9-9Z" /><path d="M8 15v-4h7m-3-3 3 3-3 3" /></svg>
    {primary ? "เส้นทางจาก รพ.พลับพลาชัย" : "เส้นทาง"}<span aria-hidden="true">↗</span>
  </a>;
}

export function MapTab() {
  const { data, fy, open, patientById, contactById, contactsOf } = useApp();
  const [pts, setPts] = useState<PointsRes | null>(null);
  const [loadingPoints, setLoadingPoints] = useState(true);
  const [revision, setRevision] = useState(0);
  const [allYears, setAllYears] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [radius, setRadius] = useState(200);
  const [showNear, setShowNear] = useState(false);
  const [nearRes, setNearRes] = useState<{ key: string; res?: NearbyRes; err?: string } | null>(null);
  const [onlyNew, setOnlyNew] = useState(true);
  const [focus, setFocus] = useState<{ patient: string; key: string } | null>(null);

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
      return res;
    }).catch((e: Error) => {
      toast((e as Error).message, "bad");
      return null;
    }).finally(() => setLoadingPoints(false));
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

  function pickPatient(id: string | null) {
    setFocus(null);
    setSel(id);
    const p = id ? located.withPt.find((p) => p.id === id) : null;
    if (p) map.current?.flyTo([p.pt.lat, p.pt.lng], radius > 200 ? 16 : 17, { duration: 0.6 });
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
        .on("click", () => pickPatient(p.id))
        .addTo(layer);
    }
    if (!selected && shown.length) map.current.fitBounds(Lf.latLngBounds(shown.map((p) => [p.pt.lat, p.pt.lng])), { padding: [30, 30], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown.map((p) => `${p.id}:${p.pt.lat}:${p.pt.lng}`).join(), sel]);

  // คนรอบบ้าน (ชีตประชากร) — โหลดใหม่เมื่อเปลี่ยนผู้ป่วย / รัศมี / บันทึกผู้สัมผัสเพิ่ม
  const contactCount = sel ? contactsOf(sel).length : 0;
  const nearKey = selected && showNear && pts?.pikad ? `${selected.id}|${radius}|${contactCount}|${revision}` : null;
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
  const focusedPerson = selected && showNear && focus?.patient === selected.id
    ? near?.people.find((n) => personKey(n) === focus.key) ?? null : null;

  function focusPerson(n: NearbyPerson) {
    if (!sel) return;
    setFocus({ patient: sel, key: personKey(n) });
    map.current?.flyTo([n.lat, n.lng], 19, { duration: 0.6 });
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
      const residents = near?.people ?? [];
      const ordered = focusedPerson ? [...residents.filter((n) => personKey(n) !== personKey(focusedPerson)), focusedPerson] : residents;
      for (const n of ordered) {
        const active = focusedPerson && personKey(n) === personKey(focusedPerson);
        Lf.circleMarker([n.lat, n.lng], {
          radius: active ? 11 : 6, weight: active ? 4 : 1.5, color: active ? "#111827" : "#fff",
          fillColor: n.ring ? RING_HEX[n.ring] : OUTSIDE_HEX, fillOpacity: active ? 1 : n.contactId ? 0.4 : 0.9,
        })
          .bindTooltip(`${esc(n.name)} · ${formatDistance(n.distance)}${n.contactId ? " · ผู้สัมผัสแล้ว" : ""}`, { direction: "top", permanent: !!active })
          .on("click", () => focusPerson(n))
          .addTo(layer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected, radius, showNear, near, focusedPerson]);

  // เลื่อนไปบ้านผู้ป่วยเฉพาะตอนเลือก / เปลี่ยนรัศมี (ผลค้นมาทีหลังไม่ดึงแผนที่กลับ)
  const focusAt = focusedPerson ? `${focusedPerson.lat},${focusedPerson.lng}` : selected ? `${selected.pt.lat},${selected.pt.lng}` : null;
  const focusZoom = focusedPerson ? 19 : radius > 200 ? 16 : 17;
  useEffect(() => {
    if (!ready || !map.current || !focusAt) return;
    const [lat, lng] = focusAt.split(",").map(Number);
    map.current.flyTo([lat, lng], focusZoom, { duration: 0.6 });
  }, [ready, focusAt, focusZoom]);

  function record(n: NearbyPerson) {
    const p = patientById(sel);
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
    <section aria-label="แผนที่บ้านผู้ป่วย" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-brand">แผนที่บ้านผู้ป่วย</h2>
          <p className="mt-1 text-sm text-muted">เลือกบ้านผู้ป่วย สำรวจคนใกล้เคียง และเปิดเส้นทางสำหรับลงเยี่ยม</p></div>
        <Button variant="ghost" disabled={loadingPoints} aria-busy={loadingPoints} onClick={() => {
          setLoadingPoints(true);
          void load(true).then((res) => { if (res && !res.error) toast("อัปเดตพิกัดล่าสุดแล้ว"); });
        }}>{loadingPoints ? "กำลังอัปเดต…" : "↻ อัปเดตพิกัด"}</Button>
      </div>
      {pts?.error && <p role="alert" className="rounded-xl border border-warn/20 bg-warn-bg p-3 text-sm text-warn">{pts.error}</p>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
      {/* isolate: z-index ของ Leaflet (400–1000) อยู่แค่ในกล่องนี้ — ไม่ทับ modal (z-50) / แถบแท็บ */}
      <div className="relative isolate z-0 lg:sticky lg:top-16">
        <div ref={box} aria-label="ตำแหน่งบ้านและวงรัศมี" className="h-[50vh] min-h-80 w-full scroll-mt-16 overflow-hidden rounded-2xl border border-line lg:h-[calc(100vh-13rem)]" />
        {focusedPerson && <div role="status" className="absolute left-12 right-3 top-3 z-[500] rounded-xl border border-brand/20 bg-white/95 px-3 py-2 text-sm shadow-md">
          <p className="text-xs text-muted">ตำแหน่งที่เลือก</p><p className="font-semibold text-brand">{focusedPerson.name}</p>
          <button className="min-h-11 text-brand underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand" onClick={() => pickPatient(sel)}>← กลับบ้านผู้ป่วย</button>
        </div>}
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
            nearPatients={nearPatients} onBack={() => pickPatient(null)} onPick={pickPatient} onRecord={record}
            onFocus={focusPerson} focusedKey={focusedPerson ? personKey(focusedPerson) : null}
            onOpenPatient={(id) => open({ type: "patient", id })}
            onOpenContact={(id) => { const c = contactById(id); if (c) open({ type: "contact", contact: c }); }}
          />
        ) : (
          <>
            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="mb-3 font-semibold">เลือกผู้ป่วย</h3>
              <Input type="search" aria-label="ค้นหาผู้ป่วย" placeholder="ค้นหาชื่อ, HN หรือตำบล" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="mt-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} /> แสดงทุกปีงบ</label>
            <p className="text-sm text-muted">
              {allYears ? "ทุกปีงบ" : `ปีงบ ${fy}`}: มีพิกัด {located.withPt.length} ราย{located.without.length ? ` · ไม่มีพิกัด ${located.without.length}` : ""}
              {pts && !pts.pikad && " · ยังไม่ได้เชื่อม ชีตประชากร (PIKAD_SPREADSHEET_ID)"}
              {pts?.pikad && ` · ชีตประชากรที่มีพิกัด ${pts.residents.toLocaleString()} คน`}
            </p>
            </div>
            <p className="px-1 text-xs text-muted">กดชื่อเพื่อเลื่อนไปยังบ้านบนแผนที่</p>
            <ul aria-label="รายชื่อผู้ป่วยที่มีพิกัด" className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto lg:max-h-none">
              {shown.map((p) => (
                <li key={p.id}>
                  <button onClick={() => pickPatient(p.id)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left transition hover:border-brand-2 hover:bg-mint/40 focus-visible:outline-2 focus-visible:outline-brand">
                    <i className="inline-block size-3 shrink-0 rounded-full" style={{ background: outcomeHex(p.outcome) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted">HN {p.hn || "-"} · {p.area || "-"}{allYears ? ` · ปีงบ ${p.fy}` : ""}</span>
                    </span>
                    <OutcomeBadge outcome={p.outcome} />
                  </button>
                </li>
              ))}
              {!shown.length && <Empty>{loadingPoints ? "กำลังโหลดพิกัด…" : q ? "ไม่พบชื่อที่ค้นหา ลองเปลี่ยนคำค้น" : "ไม่มีผู้ป่วยที่มีพิกัดในปีงบนี้"}</Empty>}
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
    </section>
  );
}

function SelectedPanel(props: {
  p: Patient & { pt: MapPoint }; radius: number; setRadius: (r: number) => void; showNear: boolean; setShowNear: (v: boolean) => void;
  pikad: boolean; near: NearbyRes | null; nearErr: string; loading: boolean; people: NearbyPerson[]; onlyNew: boolean; setOnlyNew: (v: boolean) => void;
  nearPatients: (Patient & { distance: number; ring: 1 | 2 | 3 | null })[];
  onBack: () => void; onPick: (id: string) => void; onRecord: (n: NearbyPerson) => void; onOpenPatient: (id: string) => void; onOpenContact: (id: string) => void;
  onFocus: (n: NearbyPerson) => void; focusedKey: string | null;
}) {
  const { p, radius, near } = props;
  const counts = ([1, 2, 3] as const).map((r) => (near?.people ?? []).filter((n) => n.ring === r).length);
  return (
    <>
      <Button variant="plain" className="self-start px-1" onClick={props.onBack}>← รายชื่อผู้ป่วย</Button>
      <div className="rounded-2xl border border-brand/20 bg-card p-4 shadow-sm">
        <p className="mb-2 text-xs font-medium text-muted">บ้านผู้ป่วยที่เป็นศูนย์กลางวง</p>
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <button className="min-h-11 break-words text-left text-lg font-semibold text-brand decoration-brand/30 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand" onClick={() => props.onPick(p.id)} title="ดูตำแหน่งบนแผนที่">{p.name}</button>
            <p className="mt-1 text-xs text-muted">HN {p.hn || "-"} · ปีงบ {p.fy} · เริ่มยา {p.start_date ? formatThaiDate(p.start_date) : "-"}</p>
          </div>
          <OutcomeBadge outcome={p.outcome} />
        </div>
        <p className="text-sm text-muted">{patientAddress(p) || "ยังไม่มีข้อมูลที่อยู่"}</p>
        <p className="mt-2 text-xs text-muted">
          พิกัด: {BY_LABEL[p.pt.by]}{" "}
          <a className="inline-flex min-h-8 items-center text-brand underline" target="_blank" rel="noreferrer" href={p.pt.mapLink || `https://www.google.com/maps?q=${p.pt.lat},${p.pt.lng}`}>ดูพิกัดใน Google Maps ↗</a>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="ghost" className="px-2 text-sm" onClick={() => props.onPick(p.id)}>ดูบ้านบนแผนที่</Button>
          <Button variant="ghost" className="px-2 text-sm" onClick={() => props.onOpenPatient(p.id)}>เปิดหน้าผู้ป่วย</Button>
          <div className="col-span-2"><DirectionsLink point={p.pt} name={p.name} primary /></div>
        </div>
        <p className="mt-2 text-xs text-muted">เปิด Google Maps เพื่อดูเส้นทางขับรถจากโรงพยาบาลไปบ้าน</p>
      </div>

      <div className="space-y-3 rounded-2xl border border-line bg-white p-4">
        <h3 className="font-semibold">สำรวจคนรอบบ้าน</h3>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-brand/20 bg-mint px-3 py-3 font-medium text-brand">
          <input type="checkbox" className="size-5 accent-brand" checked={props.showNear} onChange={(e) => props.setShowNear(e.target.checked)} />
          ใครใกล้คนนี้บ้าง
        </label>
        <label className="flex items-center gap-3 text-sm text-muted"><span className="shrink-0">รัศมีรอบบ้าน</span>
          <Select aria-label="รัศมีรอบบ้านผู้ป่วย" placeholder={false} value={radius} onChange={(e) => props.setRadius(Number(e.target.value))}
            options={RADII.map((r) => ({ value: r, label: formatDistance(r) }))} />
        </label>
        <p className="text-xs text-muted">วงคำนวณจากระยะรอบบ้าน ไม่ใช่ระยะทางขับรถ</p>
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
          {props.loading && <div role="status" className="animate-pulse rounded-2xl border border-line bg-white p-4 text-sm text-muted">กำลังค้นหารายชื่อคนรอบบ้าน…</div>}
          {props.nearErr && <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm text-bad">{props.nearErr}</p>}
          {near?.error && <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">{near.error}</p>}
          {near && (
            <>
              <div className="rounded-2xl border border-line bg-white p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2"><h3 className="font-semibold">คนในรัศมี {formatDistance(radius)}</h3><span className="text-lg font-semibold text-brand">{near.people.length} <span className="text-sm font-normal text-muted">คน</span></span></div>
                <div className="grid grid-cols-3 gap-2">{([1, 2, 3] as const).map((r) => <div key={r} className="rounded-xl bg-background p-2 text-center">
                  <p className="text-xs text-muted">วง {r}</p><p className="text-lg font-semibold" style={{ color: RING_HEX[r] }}>{counts[r - 1]}</p>
                  <p className="text-xs text-muted">{r === 1 ? "≤ 10 ม." : r === 2 ? "≤ 50 ม." : "≤ 200 ม."}</p>
                </div>)}</div>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm text-muted">
                <input type="checkbox" className="size-4 shrink-0 accent-brand" checked={props.onlyNew} onChange={(e) => props.setOnlyNew(e.target.checked)} /> ซ่อนคนที่เป็นผู้สัมผัส / ผู้ป่วยแล้ว
              </label>
              <p className="px-1 text-xs text-muted">แสดง {props.people.length} คน · เรียงใกล้ไปไกล · กดชื่อเพื่อดูหมุด</p>
              <ul aria-label="รายชื่อคนรอบบ้าน" className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto p-1 lg:max-h-[75vh]">
                {props.people.map((n, i) => (
                  <li key={`${n.cid ?? n.name}-${i}`} className={`rounded-2xl border p-4 text-sm transition ${props.focusedKey === personKey(n) ? "border-brand bg-mint/50 ring-2 ring-brand/20" : "border-line bg-card"}`}>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="text-xs text-muted">ห่างจากบ้านผู้ป่วย <b className="text-foreground">{formatDistance(n.distance)}</b></span>
                      <RingBadge ring={n.ring} />
                    </div>
                    <button className="min-h-11 w-full break-words text-left text-base font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand" onClick={() => props.onFocus(n)} aria-pressed={props.focusedKey === personKey(n)} title="ดูตำแหน่งบนแผนที่">{n.name}</button>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {n.age != null && <span>อายุ {n.age} ปี</span>}
                      {n.sex && <span>{n.sex}</span>}
                      {n.nationality && <span>สัญชาติ {n.nationality}</span>}
                      <Badge tone={n.deceased === true ? "muted" : n.deceased === false ? "ok" : "muted"}>{n.deceased === true ? "เสียชีวิต" : n.deceased === false ? "มีชีวิต" : "ไม่ระบุสถานะชีวิต"}</Badge>
                    </div>
                    {n.address && <p className="mt-2 break-words text-xs text-muted">{n.address}</p>}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button variant={props.focusedKey === personKey(n) ? "primary" : "ghost"} className="px-2 text-sm" onClick={() => props.onFocus(n)}>{props.focusedKey === personKey(n) ? "กำลังดูหมุดนี้" : "ดูบนแผนที่"}</Button>
                      <DirectionsLink point={n} name={n.name} />
                    </div>
                    <div className="mt-2 flex [&>button]:min-h-11 [&>button]:w-full">
                      {n.contactId ? (
                        <Button variant="plain" className="border border-contact/20 bg-contact-bg text-sm text-contact" onClick={() => props.onOpenContact(n.contactId!)}>✓ เป็นผู้สัมผัสแล้ว · เปิดข้อมูล</Button>
                      ) : n.patientId ? (
                        <Button variant="plain" className="border border-line text-sm" onClick={() => props.onOpenPatient(n.patientId!)}>ผู้ป่วยในทะเบียน · เปิดข้อมูล</Button>
                      ) : (
                        <Button variant="contact" className="text-sm" onClick={() => props.onRecord(n)}>+ บันทึกเป็นผู้สัมผัส</Button>
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
