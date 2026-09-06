import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { PDFParse } = createRequire(import.meta.url)("pdf-parse");

const raiz = "acervo";
let ok = 0, ruim = 0;
for (const cnpjDir of fs.readdirSync(raiz)) {
  const dir = path.join(raiz, cnpjDir, "situacao-fiscal");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".pdf"))) {
    const alvo = path.join(dir, f);
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(alvo)) });
    const t = (await parser.getText()).text.replace(/\s+/g, " ");
    await parser.destroy();
    const fmt = cnpjDir.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    const bate = t.includes(fmt);
    const nome = (t.match(/CNPJ:\s*[\d.]+\s+(.{5,55}?)\s+Dados/) ?? [])[1] ?? "?";
    const fab = /<titular da conta gov.br>/.test(t) && /CPF:\s*009\.040\.434-36\s*Situa/.test(t);
    console.log(`${bate ? "OK  " : "ERRO"} ${cnpjDir} ${fab ? "[E DA FABIANA!] " : ""}${nome.slice(0,48)}`);
    bate ? ok++ : ruim++;
  }
}
console.log(`\nConferidos: ${ok + ruim} | corretos: ${ok} | ERRADOS: ${ruim}`);
