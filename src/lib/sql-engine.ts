import BetterSqlite3 from "better-sqlite3";

// ─────────────────────────────────────────────────────────────────────────────
// Moteur SQL pédagogique : base SQLite 100 % en mémoire, créée à VOLONTÉ pour
// chaque exécution. La base principale de l'application n'est JAMAIS touchée.
// Instructions dangereuses bloquées (ATTACH, DETACH, LOAD, VACUUM INTO…).
// ─────────────────────────────────────────────────────────────────────────────

export interface SqlStatementResult {
  sql: string;
  kind: "select" | "write" | "ddl" | "pragma" | "other";
  rows?: Record<string, unknown>[];
  columns?: string[];
  changes?: number;
  error?: string;
}

export interface SqlRunResult {
  ok: boolean;
  statements: SqlStatementResult[];
  error?: string;
  durationMs: number;
}

const BLOCKED = /^\s*(ATTACH|DETACH|LOAD\s+EXTENSION|VACUUM\s+INTO|\.)/i;

/** Sépare les instructions en respectant guillemets simples/doubles et commentaires. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      cur += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") {
        cur += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      inLineComment = true;
      cur += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === "/" && next === "*") {
      inBlockComment = true;
      cur += ch;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === ";" && !inSingle && !inDouble) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function kindOf(stmt: string): SqlStatementResult["kind"] {
  const s = stmt.trim().toUpperCase();
  if (s.startsWith("SELECT") || s.startsWith("WITH") || s.startsWith("VALUES")) return "select";
  if (s.startsWith("PRAGMA")) return "pragma";
  if (s.startsWith("CREATE") || s.startsWith("ALTER") || s.startsWith("DROP")) return "ddl";
  if (s.startsWith("INSERT") || s.startsWith("UPDATE") || s.startsWith("DELETE")) return "write";
  return "other";
}

/**
 * Exécute un script SQL dans une base SQLite en mémoire jetable.
 * @param script    SQL de l'utilisateur
 * @param setupSql  SQL d'installation de l'environnement (fixture de l'exercice)
 */
export function runSqlScript(script: string, setupSql?: string, options?: { readOnly?: boolean }): SqlRunResult {
  const started = Date.now();
  const statements: SqlStatementResult[] = [];
  const db = new BetterSqlite3(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = OFF");
    if (setupSql && setupSql.trim()) {
      db.exec(setupSql);
    }
    for (const stmt of splitStatements(script)) {
      if (BLOCKED.test(stmt)) {
        statements.push({ sql: stmt.slice(0, 500), kind: "other", error: "Instruction non autorisée dans l'environnement pédagogique (ATTACH/LOAD/VACUUM INTO…)." });
        continue;
      }
      const kind = kindOf(stmt);
      try {
        if (kind === "select") {
          const rows = db.prepare(stmt).all() as Record<string, unknown>[];
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          statements.push({ sql: stmt.slice(0, 500), kind, rows: rows.slice(0, 200), columns, changes: rows.length });
        } else if (kind === "pragma") {
          const info = db.pragma(stmt.replace(/^PRAGMA\s+/i, "").trim().split(/\s+/)[0], { simple: false });
          statements.push({ sql: stmt.slice(0, 500), kind, rows: info as Record<string, unknown>[] });
        } else {
          const res = db.exec(stmt);
          const lastSelect = res[res.length - 1];
          statements.push({
            sql: stmt.slice(0, 500),
            kind,
            changes: db.prepare("SELECT changes()").get() ? undefined : undefined,
            rows: lastSelect?.values?.length ? undefined : undefined,
            columns: undefined,
          });
        }
      } catch (e) {
        statements.push({ sql: stmt.slice(0, 500), kind, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const hasError = statements.some((s) => s.error);
    return { ok: !hasError, statements, durationMs: Date.now() - started };
  } catch (e) {
    return { ok: false, statements, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started };
  } finally {
    db.close();
  }
}

/** Le schéma résultant (tables + colonnes) après exécution — pour comparer des exercices de création. */
export function introspectSchema(setupSql: string, userSql: string): { tables: Record<string, { columns: { name: string; type: string; notnull: boolean; pk: boolean }[] }>; error?: string } {
  const db = new BetterSqlite3(":memory:");
  try {
    if (setupSql?.trim()) db.exec(setupSql);
    for (const stmt of splitStatements(userSql)) {
      if (BLOCKED.test(stmt)) continue;
      db.exec(stmt);
    }
    const tablesRaw = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const tables: Record<string, { columns: { name: string; type: string; notnull: boolean; pk: boolean }[] }> = {};
    for (const t of tablesRaw) {
      const cols = db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all() as { name: string; type: string; notnull: number; pk: number }[];
      tables[t.name] = {
        columns: cols.map((c) => ({ name: c.name, type: (c.type || "BLOB").toUpperCase(), notnull: c.notnull === 1, pk: c.pk > 0 })),
      };
    }
    return { tables };
  } catch (e) {
    return { tables: {}, error: e instanceof Error ? e.message : String(e) };
  } finally {
    db.close();
  }
}

/** Valeurs des tables après exécution — pour comparer les données. */
export function dumpData(setupSql: string, userSql: string): { data: Record<string, Record<string, unknown>[]>; error?: string } {
  const db = new BetterSqlite3(":memory:");
  try {
    if (setupSql?.trim()) db.exec(setupSql);
    for (const stmt of splitStatements(userSql)) {
      if (BLOCKED.test(stmt)) continue;
      db.exec(stmt);
    }
    const tablesRaw = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const data: Record<string, Record<string, unknown>[]> = {};
    for (const t of tablesRaw) {
      data[t.name] = db.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}"`).all() as Record<string, unknown>[];
    }
    return { data };
  } catch (e) {
    return { data: {}, error: e instanceof Error ? e.message : String(e) };
  } finally {
    db.close();
  }
}

/** Liste des schémas d'exemple disponibles pour le laboratoire SQL libre. */
export const SQL_FIXTURES: Record<string, { label: string; description: string; setupSql: string }> = {
  bibliotheque: {
    label: "Bibliothèque",
    description: "Livres, adhérents, emprunts (jointures, agrégats).",
    setupSql: `CREATE TABLE livres (id INTEGER PRIMARY KEY, titre TEXT NOT NULL, auteur TEXT NOT NULL, annee INTEGER, categorie TEXT);
CREATE TABLE adherents (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, ville TEXT, inscrit_le DATE);
CREATE TABLE emprunts (id INTEGER PRIMARY KEY, livre_id INTEGER NOT NULL REFERENCES livres(id), adherent_id INTEGER NOT NULL REFERENCES adherents(id), date_emprunt DATE NOT NULL, date_retour DATE);
INSERT INTO livres (titre, auteur, annee, categorie) VALUES
 ('Structures de données en Java', 'R. Lafore', 2003, 'Informatique'),
 ('Le mythe du programmeur', 'F. Brooks', 1975, 'Génie logiciel'),
 ('Bases de données : principes', 'C. Date', 2004, 'Informatique'),
 ('Clean Code', 'R. Martin', 2008, 'Génie logiciel'),
 ('Réseaux et télécoms', 'A. Tanenbaum', 2011, 'Réseaux');
INSERT INTO adherents (nom, ville, inscrit_le) VALUES
 ('Alice Martin', 'Paris', '2024-09-01'), ('Karim Benali', 'Lyon', '2024-10-15'),
 ('Julie Dufour', 'Paris', '2025-01-20'), ('Marc Lefevre', 'Nantes', '2025-02-03');
INSERT INTO emprunts (livre_id, adherent_id, date_emprunt, date_retour) VALUES
 (1, 1, '2025-03-01', '2025-03-15'), (1, 2, '2025-04-02', NULL),
 (3, 1, '2025-04-10', '2025-05-01'), (4, 3, '2025-05-05', NULL),
 (5, 4, '2025-05-12', '2025-06-01');`,
  },
  entreprise: {
    label: "Entreprise (RH)",
    description: "Employés, services, salaires (GROUP BY, HAVING).",
    setupSql: `CREATE TABLE services (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, ville TEXT);
CREATE TABLE employes (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, service_id INTEGER REFERENCES services(id), salaire REAL NOT NULL, embauche DATE);
INSERT INTO services (nom, ville) VALUES ('Développement', 'Paris'), ('Réseaux', 'Lyon'), ('Support', 'Paris'), ('Direction', 'Nantes');
INSERT INTO employes (nom, service_id, salaire, embauche) VALUES
 ('Sophie Durand', 1, 3200, '2019-03-01'), ('Paul Moreau', 1, 2900, '2021-06-15'),
 ('Nadia Cherif', 2, 3100, '2020-01-10'), ('Luc Petit', 2, 2600, '2022-09-01'),
 ('Emma Rousseau', 3, 2400, '2023-02-20'), ('Hugo Bernard', 4, 4500, '2015-11-05');`,
  },
  boutique: {
    label: "Boutique en ligne",
    description: "Clients, commandes, lignes (jointures multiples, totaux).",
    setupSql: `CREATE TABLE clients (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, email TEXT UNIQUE);
CREATE TABLE produits (id INTEGER PRIMARY KEY, libelle TEXT NOT NULL, prix REAL NOT NULL, stock INTEGER DEFAULT 0);
CREATE TABLE commandes (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), date_cmd DATE NOT NULL);
CREATE TABLE lignes (commande_id INTEGER NOT NULL REFERENCES commandes(id), produit_id INTEGER NOT NULL REFERENCES produits(id), quantite INTEGER NOT NULL, PRIMARY KEY (commande_id, produit_id));
INSERT INTO clients (nom, email) VALUES ('Alice', 'alice@mail.fr'), ('Karim', 'karim@mail.fr'), ('Julie', 'julie@mail.fr');
INSERT INTO produits (libelle, prix, stock) VALUES ('Clavier mécanique', 89.9, 12), ('Souris sans fil', 29.9, 40), ('Écran 27"', 219, 7), ('Casque audio', 79, 15);
INSERT INTO commandes (client_id, date_cmd) VALUES (1, '2025-04-01'), (1, '2025-05-10'), (2, '2025-04-15'), (3, '2025-05-20');
INSERT INTO lignes VALUES (1, 1, 1), (1, 2, 2), (2, 3, 1), (3, 2, 1), (3, 4, 1), (4, 3, 2);`,
  },
  vide: {
    label: "Base vide",
    description: "Environnement vierge pour exercices de création.",
    setupSql: `SELECT 1;`,
  },
};
