import {
  escapeHtml,
  htmlToText,
  renderTemplate,
  templatePlaceholders,
} from "@/services/pec/render";
import { describe, expect, it } from "vitest";

describe("renderTemplate", () => {
  it("sostituisce {{var}} con escaping HTML", () => {
    const out = renderTemplate("<p>Spett.le {{company_name}}</p>", {
      company_name: 'Rossi & Co <"S.r.l.">',
    });
    expect(out).toBe("<p>Spett.le Rossi &amp; Co &lt;&quot;S.r.l.&quot;&gt;</p>");
  });

  it("{{{var}}} non fa escaping", () => {
    expect(renderTemplate("{{{raw}}}", { raw: "<b>x</b>" })).toBe("<b>x</b>");
  });

  it("placeholder mancanti diventano stringa vuota", () => {
    expect(renderTemplate("a{{missing}}b", {})).toBe("ab");
    expect(renderTemplate("p={{p}}", { p: null })).toBe("p=");
  });

  it("gestisce spazi dentro le graffe e chiavi ripetute", () => {
    expect(renderTemplate("{{ a }}-{{a}}", { a: "1" })).toBe("1-1");
  });
});

describe("templatePlaceholders", () => {
  it("elenca le chiavi uniche", () => {
    expect(templatePlaceholders("{{a}} {{{b}}} {{a}} {{c}}").sort()).toEqual(["a", "b", "c"]);
  });
});

describe("escapeHtml / htmlToText", () => {
  it("escapeHtml copre i 5 caratteri", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("htmlToText rende un testo leggibile", () => {
    const txt = htmlToText("<p>Ciao {{x}}</p><p>Riga 2<br>Riga 3</p>");
    expect(txt).toBe("Ciao {{x}}\nRiga 2\nRiga 3");
  });
});
