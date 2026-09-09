import { stripAccents } from "@/lib/text";

/** Sigla provincia (ISO 3166-2:IT senza prefisso) -> denominazione. */
export const PROVINCES: Record<string, string> = {
  AG: "Agrigento",
  AL: "Alessandria",
  AN: "Ancona",
  AO: "Aosta",
  AR: "Arezzo",
  AP: "Ascoli Piceno",
  AT: "Asti",
  AV: "Avellino",
  BA: "Bari",
  BT: "Barletta-Andria-Trani",
  BL: "Belluno",
  BN: "Benevento",
  BG: "Bergamo",
  BI: "Biella",
  BO: "Bologna",
  BZ: "Bolzano",
  BS: "Brescia",
  BR: "Brindisi",
  CA: "Cagliari",
  CL: "Caltanissetta",
  CB: "Campobasso",
  CE: "Caserta",
  CT: "Catania",
  CZ: "Catanzaro",
  CH: "Chieti",
  CO: "Como",
  CS: "Cosenza",
  CR: "Cremona",
  KR: "Crotone",
  CN: "Cuneo",
  EN: "Enna",
  FM: "Fermo",
  FE: "Ferrara",
  FI: "Firenze",
  FG: "Foggia",
  FC: "Forlì-Cesena",
  FR: "Frosinone",
  GE: "Genova",
  GO: "Gorizia",
  GR: "Grosseto",
  IM: "Imperia",
  IS: "Isernia",
  AQ: "L'Aquila",
  SP: "La Spezia",
  LT: "Latina",
  LE: "Lecce",
  LC: "Lecco",
  LI: "Livorno",
  LO: "Lodi",
  LU: "Lucca",
  MC: "Macerata",
  MN: "Mantova",
  MS: "Massa-Carrara",
  MT: "Matera",
  ME: "Messina",
  MI: "Milano",
  MO: "Modena",
  MB: "Monza e della Brianza",
  NA: "Napoli",
  NO: "Novara",
  NU: "Nuoro",
  OR: "Oristano",
  PD: "Padova",
  PA: "Palermo",
  PR: "Parma",
  PV: "Pavia",
  PG: "Perugia",
  PU: "Pesaro e Urbino",
  PE: "Pescara",
  PC: "Piacenza",
  PI: "Pisa",
  PT: "Pistoia",
  PN: "Pordenone",
  PZ: "Potenza",
  PO: "Prato",
  RG: "Ragusa",
  RA: "Ravenna",
  RC: "Reggio Calabria",
  RE: "Reggio Emilia",
  RI: "Rieti",
  RN: "Rimini",
  RM: "Roma",
  RO: "Rovigo",
  SA: "Salerno",
  SS: "Sassari",
  SV: "Savona",
  SI: "Siena",
  SR: "Siracusa",
  SO: "Sondrio",
  SU: "Sud Sardegna",
  TA: "Taranto",
  TE: "Teramo",
  TR: "Terni",
  TO: "Torino",
  TP: "Trapani",
  TN: "Trento",
  TV: "Treviso",
  TS: "Trieste",
  UD: "Udine",
  VA: "Varese",
  VE: "Venezia",
  VB: "Verbano-Cusio-Ossola",
  VC: "Vercelli",
  VR: "Verona",
  VV: "Vibo Valentia",
  VI: "Vicenza",
  VT: "Viterbo",
};

/** Denominazioni alternative / storiche -> sigla. Chiavi già senza accenti e in minuscolo. */
const NAME_ALIASES: Record<string, string> = {
  "reggio nell emilia": "RE",
  "reggio di calabria": "RC",
  "valle d aosta": "AO",
  bozen: "BZ",
  monza: "MB",
  "monza brianza": "MB",
  "monza e brianza": "MB",
  forli: "FC",
  "forli cesena": "FC",
  massa: "MS",
  carrara: "MS",
  "massa carrara": "MS",
  pesaro: "PU",
  urbino: "PU",
  "l aquila": "AQ",
  aquila: "AQ",
  verbania: "VB",
  "verbano cusio ossola": "VB",
  "barletta andria trani": "BT",
  "olbia tempio": "SS",
  "medio campidano": "SU",
  "carbonia iglesias": "SU",
  ogliastra: "NU",
};

const BY_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = { ...NAME_ALIASES };
  for (const [code, name] of Object.entries(PROVINCES)) {
    m[
      stripAccents(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    ] = code;
  }
  return m;
})();

export interface ProvinceMatch {
  code: string;
  name: string;
}

/**
 * Riconosce una provincia da sigla ("MI"), denominazione ("Milano"),
 * denominazione estesa o alias storico. Ritorna null se non riconosciuta
 * (l'import prosegue comunque con province = null).
 */
export function normalizeProvince(input: string | null | undefined): ProvinceMatch | null {
  if (!input) return null;
  const raw = stripAccents(input).trim();

  // sigla a 2 lettere
  const code = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(code) && PROVINCES[code]) {
    return { code, name: PROVINCES[code] };
  }

  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const byName = BY_NAME[key];
  if (byName) return { code: byName, name: PROVINCES[byName] ?? key };

  // "provincia di milano" / "milano (mi)" / "milano mi"
  const stripped = key
    .replace(/^prov(incia)?\s+(di\s+)?/, "")
    .replace(/\s+[a-z]{2}$/, "")
    .trim();
  if (stripped !== key && BY_NAME[stripped]) {
    const c = BY_NAME[stripped];
    return { code: c, name: PROVINCES[c] ?? stripped };
  }

  return null;
}
