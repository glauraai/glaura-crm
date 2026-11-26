import { describe, expect, it } from "vitest";
import { buildLeads, decodeCsvBytes, detectMapping, metiersFrom, parseCsv, rowToLead } from "./csv-import";

const importText = (text: string) => { const parsed = parseCsv(text); return { parsed, mapping: detectMapping(parsed), leads: buildLeads(parsed, detectMapping(parsed)) }; };

describe("decodeCsvBytes", () => {
  it("reads UTF-8 and strips the BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Nom\nBeauté")]);
    expect(decodeCsvBytes(bytes)).toBe("Nom\nBeauté");
  });
  it("falls back to Windows-1252 for French Excel exports", () => {
    expect(decodeCsvBytes(new Uint8Array([0x42, 0x65, 0x61, 0x75, 0x74, 0xe9]))).toBe("Beauté");
  });
});

describe("parseCsv", () => {
  it("detects semicolons, quoted cells with delimiters and newlines, CRLF", () => {
    const { headers, rows } = parseCsv('Nom;Adresse;Notes\r\n"Salon ""Chic""";"12 rue A; Paris";"ligne 1\nligne 2"\r\n');
    expect(headers).toEqual(["Nom", "Adresse", "Notes"]);
    expect(rows).toEqual([['Salon "Chic"', "12 rue A; Paris", "ligne 1\nligne 2"]]);
  });
  it("handles tabs, ragged rows and blank lines", () => {
    const { rows } = parseCsv("Nom\tVille\tTel\nA\tParis\n\n\nB\tLyon\t0611223344\textra\n");
    expect(rows).toEqual([["A", "Paris", "", ""], ["B", "Lyon", "0611223344", "extra"]]);
  });
  it("returns an empty result for an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], hasHeader: false });
    expect(importText("\n\n").leads).toEqual([]);
  });
  it("detects a file without header row", () => {
    const { parsed, leads } = importText("Salon Lila,contact@lila.fr,06 11 22 33 44\nNail Bar,hello@nail.fr,0712345678\n");
    expect(parsed.hasHeader).toBe(false);
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ name: "Salon Lila", email: "contact@lila.fr", phone: "06 11 22 33 44" });
  });
});

describe("detectMapping", () => {
  it("matches French headers regardless of accents and case", () => {
    const { mapping } = importText("NOM DU SALON,Téléphone,E-mail,Code Postal,Ville,Compte Instagram,Gérante,Métier\nX,0611223344,a@b.fr,75011,Paris,@x,Lea,Ongles\n");
    expect(mapping).toEqual(["name", "phone", "email", "postalCode", "city", "instagram", "contactName", "metier"]);
  });
  it("matches English headers", () => {
    const { mapping } = importText("Business Name,Phone Number,Email Address,Website,Zip Code\nX,0611223344,a@b.fr,https://x.fr,75011\n");
    expect(mapping).toEqual(["name", "phone", "email", "website", "postalCode"]);
  });
  it("trusts values over a loose header", () => {
    const { mapping } = importText("Salon,Email du gérant\nX,lea@x.fr\nY,max@y.fr\n");
    expect(mapping).toEqual(["name", "email"]);
  });
  it("maps unknown headers by their content", () => {
    const { mapping } = importText("Truc,Machin,Bidule\nSalon A,https://www.planity.com/salon-a-75011,0611223344\nSalon B,https://www.planity.com/salon-b-75012,0711223344\n");
    expect(mapping).toEqual(["name", "bookingUrl", "phone"]);
  });
  it("reads a 'Note' column as rating only when it is numeric", () => {
    expect(importText("Nom,Note\nA,4.5\nB,4,8\n").mapping[1]).toBe("rating");
    expect(importText("Nom,Note\nA,rappeler lundi\n").mapping[1]).toBe("notes");
  });
  it("maps every column of the downloadable template", () => {
    const { mapping } = importText("\uFEFFNom du salon;Adresse;Code postal;Ville;Téléphone;E-mail;Instagram;Site web;Lien Planity / Treatwell;Contact;Métier;Notes\r\nSalon Exemple;12 rue Oberkampf;75011;Paris;06 12 34 56 78;contact@salon-exemple.fr;@salonexemple;https://salon-exemple.fr;;Léa;Ongles;Rappeler lundi");
    expect(mapping).toEqual(["name", "address", "postalCode", "city", "phone", "email", "instagram", "website", "bookingUrl", "contactName", "metier", "notes"]);
  });
  it("uses each field once", () => {
    const { mapping } = importText("Téléphone,Tel portable\n0611223344,0711223344\n");
    expect(mapping.filter(f => f === "phone")).toHaveLength(1);
  });
});

describe("rowToLead", () => {
  it("never produces an empty name", () => {
    const headers = ["Nom", "Contact", "Instagram", "Email", "Tel"];
    const mapping = ["name", "contactName", "instagram", "email", "phone"] as const;
    expect(rowToLead(["", "Léa", "", "", ""], headers, [...mapping], 2).name).toBe("Léa");
    expect(rowToLead(["", "", "https://instagram.com/lila.nails", "", ""], headers, [...mapping], 2).name).toBe("@lila.nails");
    expect(rowToLead(["", "", "", "hello@salon.fr", ""], headers, [...mapping], 2).name).toBe("hello");
    expect(rowToLead(["", "", "", "", "0611"], headers, [...mapping], 2).name).toBe("0611");
    expect(rowToLead(["", "", "", "", ""], headers, [...mapping], 7).name).toBe("Lead importé (ligne 7)");
  });
  it("keeps unmapped columns and invalid values in the notes", () => {
    const lead = rowToLead(["A", "pas un mail", "Budget 200€", "rappeler"], ["Nom", "Email", "Budget", "Notes"], ["name", "email", null, "notes"], 2);
    expect(lead.email).toBeNull();
    expect(lead.notes).toBe("rappeler\nBudget : Budget 200€\nE-mail : pas un mail");
  });
  it("extracts postal code and city from the address and splits booking links", () => {
    const lead = rowToLead(["A", "12 rue Oberkampf, 75011 Paris", "www.treatwell.fr/salon/a"], ["Nom", "Adresse", "Site"], ["name", "address", "website"], 2);
    expect(lead).toMatchObject({ postalCode: "75011", city: "Paris", treatwellUrl: "https://www.treatwell.fr/salon/a", website: null });
  });
  it("cleans spreadsheet artifacts and numbers", () => {
    const lead = rowToLead(["A", "'+33611223344", "4,7", "1 234 avis"], ["Nom", "Tel", "Note", "Avis"], ["name", "phone", "rating", "reviewCount"], 2);
    expect(lead).toMatchObject({ phone: "+33611223344", rating: 4.7, reviewCount: 1234 });
  });
  it("restores the leading zero Excel drops from postal codes", () => {
    expect(rowToLead(["A", "6000"], ["Nom", "CP"], ["name", "postalCode"], 2).postalCode).toBe("06000");
  });
});

describe("metiersFrom", () => {
  it("maps free text to CRM métiers", () => {
    expect(metiersFrom("Onglerie & Cils")).toEqual(["ONGLES", "ESTHETIQUE"]);
    expect(metiersFrom("Barber shop")).toEqual(["BARBIER"]);
    expect(metiersFrom("Tatouage")).toEqual(["AUTRE"]);
  });
});
