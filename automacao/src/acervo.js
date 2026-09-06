/**
 * ACERVO — onde os documentos baixados ficam guardados.
 *
 * A pasta antiga era organizada por dia (`relatorios/2026-09-05/...`). Isso
 * serve para ver "o que rodou hoje" e é péssimo para a pergunta que a equipe
 * de fato faz: "cadê a última situação fiscal da Padaria do Zé?" — que exigia
 * abrir trinta pastas de datas.
 *
 * Aqui a organização é por CLIENTE e por TIPO de documento, com a data no nome
 * do arquivo. O histórico fica em ordem dentro de uma pasta só.
 *
 *   acervo/
 *     09629304000197/
 *       situacao-fiscal/
 *         2026-09-05_situacao-fiscal.pdf
 *         2026-09-12_situacao-fiscal.pdf
 *       cnd-federal/
 *         2026-09-05_cnd-federal.pdf
 *     _indice.json
 *
 * Duas regras que valem mais do que parecem:
 *
 * 1. NADA É SOBRESCRITO. Documento fiscal é prova. Se dois arquivos do mesmo
 *    dia forem diferentes, o segundo vira `-2`, e os dois ficam.
 *
 * O acervo pode ter um DESTINO REMOTO (Google Drive). A ordem é sempre a
 * mesma: grava local primeiro, sobe depois. Se a internet cair no meio, o
 * documento já está salvo e a subida entra na fila da próxima execução — o
 * contrário perderia o arquivo.
 *
 * 2. ARQUIVO IDÊNTICO NÃO VIRA CÓPIA NOVA. Se o PDF de hoje tem o mesmo
 *    SHA-256 do último guardado, o acervo registra "visto de novo em tal dia"
 *    em vez de duplicar. Assim o histórico mostra MUDANÇA, não repetição —
 *    e "essa pendência é a mesma da semana passada" vira informação, não
 *    trabalho de conferir arquivo por arquivo.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Tipos que o acervo conhece. O robô só coleta o primeiro hoje; os demais
// existem aqui para que a coleta de certidões caia no lugar certo quando for
// implementada, em vez de inventar uma pasta nova na pressa.
export const TIPOS = {
  'situacao-fiscal': 'Relatório de Situação Fiscal',
  'cnd-federal': 'CND Federal (RFB/PGFN)',
  'cnd-fgts': 'CRF — FGTS',
  'cnd-trabalhista': 'CNDT — Trabalhista',
  'cnd-estadual': 'Certidão Estadual',
  'cnd-municipal': 'Certidão Municipal',
  'caixa-postal': 'Caixa Postal / DTE',
};

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const hoje = () => new Date().toISOString().slice(0, 10);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export class Acervo {
  constructor(raiz, remoto = null) {
    this.raiz = path.resolve(raiz);
    this.caminhoIndice = path.join(this.raiz, '_indice.json');
    this.indice = null;
    this.remoto = remoto; // opcional: Drive
  }

  async abrir() {
    await fs.mkdir(this.raiz, { recursive: true });
    try {
      this.indice = JSON.parse(await fs.readFile(this.caminhoIndice, 'utf8'));
    } catch {
      this.indice = { versao: 1, atualizadoEm: null, documentos: [] };
    }
    return this;
  }

  async salvarIndice() {
    this.indice.atualizadoEm = new Date().toISOString();
    await fs.writeFile(this.caminhoIndice, JSON.stringify(this.indice, null, 2) + '\n', 'utf8');
  }

  /** O último documento guardado de um cliente para um tipo. */
  ultimo(cnpj, tipo) {
    const j = digitos(cnpj);
    return this.indice.documentos
      .filter((d) => d.cnpj === j && d.tipo === tipo)
      .sort((a, b) => b.coletadoEm.localeCompare(a.coletadoEm))[0] || null;
  }

  async caminhoLivre(pasta, base, ext) {
    for (let n = 1; n < 100; n += 1) {
      const nome = n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`;
      const alvo = path.join(pasta, nome);
      try {
        await fs.access(alvo);
      } catch {
        return alvo; // não existe: é este
      }
    }
    throw new Error(`Cem arquivos com o nome ${base} no mesmo dia — algo está errado.`);
  }

  /**
   * Guarda um documento. `conteudo` é um Buffer.
   * Devolve { estado: 'novo' | 'igual', caminho, hash, ... }.
   */
  async guardar({ cnpj, tipo, conteudo, apelido = null, certificado = null, ext = '.pdf' }) {
    if (!TIPOS[tipo]) throw new Error(`Tipo de documento desconhecido: ${tipo}`);
    const j = digitos(cnpj);
    if (j.length !== 14) throw new Error(`CNPJ inválido para o acervo: ${cnpj}`);
    if (!Buffer.isBuffer(conteudo) || !conteudo.length) throw new Error('Documento vazio.');

    const hash = sha256(conteudo);
    const agora = new Date().toISOString();
    const anterior = this.ultimo(j, tipo);

    // Igual ao último: registra que foi visto de novo, não duplica o arquivo.
    if (anterior && anterior.hash === hash) {
      anterior.vistoEm = anterior.vistoEm || [];
      anterior.vistoEm.push(agora);
      anterior.conferidoEm = agora;
      await this.salvarIndice();
      return { estado: 'igual', caminho: anterior.caminho, hash, desde: anterior.coletadoEm };
    }

    const pasta = path.join(this.raiz, j, tipo);
    await fs.mkdir(pasta, { recursive: true });
    const alvo = await this.caminhoLivre(pasta, `${hoje()}_${tipo}`, ext);
    await fs.writeFile(alvo, conteudo);

    const registro = {
      cnpj: j,
      apelido,
      tipo,
      rotulo: TIPOS[tipo],
      caminho: path.relative(this.raiz, alvo),
      bytes: conteudo.length,
      hash,
      coletadoEm: agora,
      conferidoEm: agora,
      certificado,
      // Só faz sentido quando existe um anterior: diz que ESTE documento
      // trouxe conteúdo diferente do último guardado.
      mudou: Boolean(anterior),
      anterior: anterior ? anterior.caminho : null,
    };
    this.indice.documentos.push(registro);
    await this.salvarIndice();

    // Local está seguro. Agora tenta o remoto; falhar aqui não perde nada.
    await this.subir(registro);
    await this.salvarIndice();

    return { estado: 'novo', ...registro };
  }

  /**
   * Sobe um registro para o destino remoto. Falha vira pendência, não erro:
   * a coleta não pode parar porque a internet oscilou.
   */
  async subir(registro) {
    if (!this.remoto) return registro;
    if (registro.remotoId) return registro; // já está lá
    try {
      const r = await this.remoto.subir({
        caminhoLocal: path.join(this.raiz, registro.caminho),
        cnpj: registro.cnpj,
        tipo: registro.tipo,
        nome: path.basename(registro.caminho),
      });
      registro.remotoId = r.id;
      registro.link = r.link;
      registro.pendente = false;
      delete registro.erroEnvio;
    } catch (e) {
      registro.pendente = true;
      registro.erroEnvio = e.message;
    }
    return registro;
  }

  /**
   * Reenvia tudo que ficou para trás. Rodar isto no começo de cada coleta é
   * o que faz uma queda de internet virar atraso em vez de buraco.
   */
  async reenviarPendentes() {
    if (!this.remoto) return { tentados: 0, enviados: 0 };
    const fila = this.indice.documentos.filter((d) => d.pendente && !d.remotoId);
    let enviados = 0;
    for (const d of fila) {
      await this.subir(d);
      if (d.remotoId) enviados += 1;
    }
    if (fila.length) await this.salvarIndice();
    return { tentados: fila.length, enviados };
  }

  /**
   * A linha do tempo de um documento: cada coleta que trouxe conteúdo
   * diferente, mais quantas vezes ele foi conferido sem mudar entre uma e
   * outra. É a diferença entre "temos 12 PDFs" e "mudou 3 vezes em 12
   * conferências" — a segunda é informação, a primeira é armazenamento.
   */
  historico(cnpj, tipo) {
    const j = digitos(cnpj);
    return this.indice.documentos
      .filter((d) => d.cnpj === j && d.tipo === tipo)
      .sort((a, b) => a.coletadoEm.localeCompare(b.coletadoEm))
      .map((d, i) => ({
        em: d.coletadoEm,
        ate: d.conferidoEm,
        conferencias: 1 + (d.vistoEm?.length ?? 0),
        mudou: i > 0,
        caminho: d.caminho,
        link: d.link ?? null,
        bytes: d.bytes,
      }));
  }

  /**
   * O que mudou desde uma data, na carteira inteira. É a pergunta que o
   * escritório faz de manhã — e a única que justifica automatizar a coleta,
   * porque "baixar 112 PDFs" só troca trabalho manual por leitura manual.
   */
  mudancasDesde(desde) {
    const corte = typeof desde === 'string' ? desde : new Date(desde).toISOString();
    return this.indice.documentos
      .filter((d) => d.mudou && d.coletadoEm >= corte)
      .sort((a, b) => b.coletadoEm.localeCompare(a.coletadoEm))
      .map((d) => ({
        cnpj: d.cnpj,
        apelido: d.apelido,
        tipo: d.tipo,
        rotulo: d.rotulo,
        em: d.coletadoEm,
        caminho: d.caminho,
        link: d.link ?? null,
        anterior: d.anterior,
      }));
  }

  /** Quando foi a última coleta de qualquer coisa. */
  ultimaColeta() {
    const datas = this.indice.documentos.map((d) => d.conferidoEm).filter(Boolean);
    return datas.length ? datas.sort().pop() : null;
  }

  /** Um resumo por cliente, para o sistema exibir. */
  porCliente() {
    const mapa = new Map();
    for (const d of this.indice.documentos) {
      if (!mapa.has(d.cnpj)) mapa.set(d.cnpj, {});
      const porTipo = mapa.get(d.cnpj);
      const atual = porTipo[d.tipo];
      if (!atual || d.coletadoEm > atual.coletadoEm) {
        porTipo[d.tipo] = {
          rotulo: d.rotulo,
          caminho: d.caminho,
          coletadoEm: d.coletadoEm,
          conferidoEm: d.conferidoEm,
          mudou: d.mudou,
          bytes: d.bytes,
          link: d.link ?? null,
          pendente: Boolean(d.pendente),
          versoes: this.indice.documentos.filter((x) => x.cnpj === d.cnpj && x.tipo === d.tipo).length,
        };
      }
    }
    return Object.fromEntries(mapa);
  }
}

export async function abrirAcervo(raiz, remoto = null) {
  return new Acervo(raiz, remoto).abrir();
}
