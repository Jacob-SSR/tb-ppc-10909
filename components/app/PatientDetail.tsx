"use client";
import { Badge, Button, Empty, Modal, Section, toast } from "@/components/ui";
import { CONTACT_TYPE_LABEL } from "@/lib/tb/constants";
import { isTB, tbTreatPlace } from "@/lib/tb/contacts";
import { addDays } from "@/lib/tb/dates";
import { followupsForForm, toFollowupInput } from "@/lib/tb/followups";
import { patientStart } from "@/lib/tb/tasks";
import { api } from "./api";
import { ContactCard, ContactSummaryLine, Info, isRR, OutcomeBadge, TaskLine, th } from "./bits";
import { useApp } from "./store";
import { Timeline } from "./Timeline";
import { exportPatientWord } from "./wordExports";

export function PatientDetail({ id }: { id: string }) {
  const store = useApp();
  const { patientById, contactsOf, followupsOf, open, isAdmin, unitName, data, reload, tasksOfPatient } = store;
  const p = patientById(id);
  if (!p) return <Modal open onClose={() => open(null)} title="ไม่พบผู้ป่วย"><Empty>อาจถูกลบแล้ว หรืออยู่นอกเขตที่ท่านดูได้</Empty></Modal>;

  const contacts = contactsOf(id);
  const tbContacts = contacts.filter(isTB);
  const fus = followupsForForm(followupsOf(id).map(toFollowupInput));
  const tasks = isAdmin ? tasksOfPatient(p) : [];
  const episodes = data.patients.filter((x) => x.id !== p.id && ((p.hn && x.hn === p.hn) || (p.cid && x.cid === p.cid)));
  // HN นี้เคยถูกบันทึกเป็นผู้สัมผัสของผู้ป่วยรายอื่น (ระบบเดิมแสดงในส่วน "เคยขึ้นทะเบียน")
  const asContact = data.contacts.filter((c) => p.hn && c.hn === p.hn && c.new_patient_id !== p.id && c.patient_id !== p.id);
  const close = () => open(null);

  async function remove() {
    if (!confirm(`ยืนยันลบ "${p!.name}" ?`)) return;
    try {
      await api("DELETE", `/api/patients/${id}?version=${p!.version}`);
      toast("ลบแล้ว");
      close();
      await reload();
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  return (
    <Modal
      open
      wide
      onClose={close}
      title={<span className="flex flex-wrap items-center gap-2">{p.name} <OutcomeBadge outcome={p.outcome} /></span>}
      subtitle={`HN ${p.hn || "-"} · TB no. ${p.tb_no || "-"} · ปีงบ ${p.fy}`}
      footer={
        <>
          {isAdmin && <Button variant="danger" size="sm" onClick={remove}>ลบ</Button>}
          {isAdmin && <Button variant="ghost" size="sm" onClick={() => open({ type: "history", id, title: `${p.name} · HN ${p.hn || "-"}`, back: { type: "patient", id } })}>ประวัติการแก้ไข</Button>}
          {isAdmin && <Button variant="ghost" size="sm" onClick={() => exportPatientWord(store, p)}>📄 ส่งออก Word</Button>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={close}>ปิด</Button>
          {isAdmin && <Button onClick={() => open({ type: "patientForm", patient: p })}>แก้ไขข้อมูลผู้ป่วย</Button>}
        </>
      }
    >
      {isAdmin && (
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Info label="ประเภท">{p.patient_type}</Info>
          <Info label="วันเริ่มยา">{th(p.start_date)}</Info>
          <Info label="สูตรยา">{p.regimen}</Info>
          <Info label="วินิจฉัย">{p.diag_basis}</Info>
          <Info label="ผลดื้อ Rifampicin">{p.rr}</Info>
          <Info label="ที่อยู่ตามทะเบียน">{[p.address, p.area].filter(Boolean).join(" ")}</Info>
          {p.current_address && <Info label="ที่อยู่ปัจจุบัน">{p.current_address}</Info>}
          <Info label="รพ.สต.รับผิดชอบ">{unitName(p.unit_id)}</Info>
          <Info label="โรคร่วม">{p.comorbid}</Info>
        </div>
      )}
      {!isAdmin && <p className="mb-3 text-sm text-muted">วันเริ่มยา {th(patientStart(p))} — ข้อมูลการรักษาของผู้ป่วยดูได้เฉพาะทีม รพ.</p>}
      {isRR(p) && <p className="mb-3 rounded-xl bg-bad-bg p-3 text-sm text-bad">⚠ ดื้อ Rifampicin: ส่งต่อศูนย์วัณโรคดื้อยาจังหวัด แยกผู้ป่วย แจ้งภายใน 24 ชม. และคัดกรองวงที่ 3 ด้วย</p>}
      {tasks.length > 0 && (
        <div className="mb-3 flex flex-col gap-0.5 rounded-xl bg-warn-bg p-3 text-sm">
          {tasks.map((t) => <TaskLine key={t.step + t.what} t={t} today={data.today} />)}
        </div>
      )}

      {isAdmin && (
        <Section title="4 ติดตามระหว่างรักษา">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-1 pr-3 font-medium">เดือนที่</th><th className="pr-3 font-medium">ตรวจ</th><th className="pr-3 font-medium">วันที่</th><th className="font-medium">ผล</th></tr></thead>
              <tbody>
                {fus.map((f) => (
                  <tr key={f.slot} className="border-t border-line">
                    <td className="py-1.5 pr-3">{f.month_no}</td><td className="pr-3">{f.test}</td><td className="pr-3">{th(f.test_date) || "–"}</td><td>{f.result || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title={`ผู้สัมผัส (${contacts.length})`} tone="contact">
        <div className="mb-2"><ContactSummaryLine patientId={id} /></div>
        {tbContacts.length > 0 && (
          <div className="mb-3 rounded-xl bg-bad-bg p-3 text-sm">
            <div className="mb-1 font-semibold text-bad">ผู้สัมผัสที่ป่วยเป็นวัณโรค</div>
            <ul className="space-y-1">
              {tbContacts.map((c) => {
                const place = tbTreatPlace(c, patientById(c.new_patient_id));
                return (
                  <li key={c.id}>
                    {c.name} <Badge tone={c.contact_type === "close" ? "muted" : "contact"}>{CONTACT_TYPE_LABEL[c.contact_type]}</Badge>{" "}
                    — รักษาที่ {place.place || <span className="text-muted">ยังไม่ระบุ</span>}
                    {place.patientId && patientById(place.patientId) && (
                      <button className="ml-2 text-brand-2 underline" onClick={() => open({ type: "patient", id: place.patientId! })}>ดูผู้ป่วยรายนี้</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {contacts.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{contacts.map((c) => <ContactCard key={c.id} c={c} showIndex={false} />)}</div>
        ) : (
          <Empty>ยังไม่มีผู้สัมผัส · ควรสอบสวนภายใน {th(addDays(patientStart(p) ?? data.today, 7))}</Empty>
        )}
        <div className="mt-3">
          <Button variant="contact" size="sm" onClick={() => open({
            type: "contact",
            contact: { patient_id: id, contact_type: "household", ring: 1, unit_id: isAdmin ? (p.unit_id ?? undefined) : data.user.unitId, address: [p.address, p.area].filter(Boolean).join(" ") || null, current_address: p.current_address ?? null },
          })}>+ เพิ่มผู้สัมผัส</Button>
        </div>
      </Section>

      {isAdmin && <Timeline refId={id} label={p.name} canAdd />}

      {(episodes.length > 0 || asContact.length > 0) && (
        <Section title={episodes.length ? `เคยขึ้นทะเบียนวัณโรค (${episodes.length} ครั้ง)` : "ประวัติเดิม"}>
          {episodes.map((x) => (
            <button key={x.id} onClick={() => open({ type: "patient", id: x.id })} className="mb-1 block w-full rounded-xl border border-line p-2 text-left text-sm hover:border-brand-2">
              ปีงบ {x.fy} · {x.patient_type || "-"} · เริ่มยา {th(x.start_date) || "-"} · {x.regimen ?? ""} <OutcomeBadge outcome={x.outcome} />
            </button>
          ))}
          {asContact.length > 0 && (
            <p className="mt-1 text-sm text-warn">เคยเป็นผู้สัมผัสของผู้ป่วย {asContact.map((c) => patientById(c.patient_id)?.name ?? "?").join(", ")}</p>
          )}
        </Section>
      )}
      {isAdmin && p.notes && <Section title="บันทึก"><div className="whitespace-pre-wrap text-sm">{p.notes}</div></Section>}
    </Modal>
  );
}
