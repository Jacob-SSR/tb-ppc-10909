// ส่งออกไฟล์ Word (.docx) ฝั่ง browser — แบบเดียวกับ downloadWord ของระบบเดิม (ฟอนต์ TH SarabunPSK)
// ใช้ข้อมูลที่ผู้ใช้เห็นอยู่แล้ว (server กรองตามสิทธิ์ §3 มาแล้ว) จึงไม่ต้องมี API เพิ่ม
// โหลดไลบรารี docx เฉพาะตอนกดส่งออก ไม่ให้หน้าแรกช้า

export type Block =
  | { t: "h1" | "h2" | "p" | "sub" | "warn"; text: string }
  | { t: "kv"; rows: [string, string | number | null | undefined][] }
  | { t: "table"; head: string[]; rows: (string | number | null | undefined)[][]; widths?: number[] };

const FONT = "TH SarabunPSK";
const MARGIN = 1000;
const A4 = { w: 11906, h: 16838 };

export async function downloadWord(filename: string, title: string, blocks: Block[], opts: { landscape?: boolean; footer: string }) {
  const D = await import("docx");
  const usable = (opts.landscape ? A4.h : A4.w) - 2 * MARGIN;
  const run = (text: string, o: { size?: number; bold?: boolean; color?: string } = {}) =>
    String(text).split("\n").map((x, i) => new D.TextRun({ text: x, font: FONT, size: o.size ?? 28, bold: o.bold, color: o.color, break: i ? 1 : 0 }));
  const para = (text: string, o: { size?: number; bold?: boolean; color?: string } = {}, spacing: { before?: number; after?: number } = { after: 60 }) =>
    new D.Paragraph({ children: run(text, o), spacing });
  const cellText = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

  const none = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const line = { style: D.BorderStyle.SINGLE, size: 4, color: "888888" };
  const table = (head: string[] | null, rows: unknown[][], widthsPct: number[]) => {
    const widths = widthsPct.map((x) => Math.round((usable * x) / 100));
    const kv = head === null;
    const mkRow = (cells: unknown[], isHead: boolean) =>
      new D.TableRow({
        cantSplit: true,
        tableHeader: isHead,
        children: cells.map((c, i) => new D.TableCell({
          width: { size: widths[i] ?? widths[0], type: D.WidthType.DXA },
          shading: isHead ? { type: D.ShadingType.CLEAR, fill: "E6EFEC", color: "auto" } : undefined,
          margins: { top: 30, bottom: 30, left: 80, right: 80 },
          children: [para(cellText(c), { size: kv ? 30 : 26, bold: isHead, color: kv && i === 0 ? "555555" : undefined }, { after: 0 })],
        })),
      });
    return new D.Table({
      width: { size: usable, type: D.WidthType.DXA },
      columnWidths: widths,
      borders: kv
        ? { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
        : { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
      rows: [
        ...(head ? [mkRow(head, true)] : []),
        ...(rows.length ? rows.map((r) => mkRow(r, false)) : head ? [mkRow([`ไม่มีข้อมูล`, ...head.slice(1).map(() => "")], false)] : []),
      ],
    });
  };

  const children: (InstanceType<typeof D.Paragraph> | InstanceType<typeof D.Table>)[] = [];
  for (const b of blocks) {
    if (b.t === "h1") children.push(para(b.text, { size: 40, bold: true, color: "1D4D40" }));
    else if (b.t === "h2") children.push(para(b.text, { size: 32, bold: true, color: "1D4D40" }, { before: 240, after: 80 }));
    else if (b.t === "sub") children.push(para(b.text, { size: 26, color: "666666" }));
    else if (b.t === "warn") children.push(para(b.text, { bold: true, color: "B42318" }));
    else if (b.t === "p") children.push(para(b.text, { size: 30 }));
    else if (b.t === "kv") children.push(table(null, b.rows.map(([k, v]) => [k, v]), [28, 72]));
    else if (b.t === "table") children.push(table(b.head, b.rows, b.widths ?? b.head.map(() => 100 / b.head.length)));
  }
  children.push(para(opts.footer, { size: 24, color: "888888" }, { before: 300 }));

  const doc = new D.Document({
    creator: "ทะเบียนวัณโรค รพ.พลับพลาชัย",
    title,
    styles: { default: { document: { run: { font: FONT, size: 30 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: A4.w, height: A4.h, orientation: opts.landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children,
    }],
  });
  const blob = await D.Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/[\\/:*?"<>|]/g, "_")}.docx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
