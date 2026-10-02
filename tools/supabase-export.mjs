// Gabungkan semua migrasi Prisma jadi satu file SQL yang bisa ditempel ke
// Supabase SQL Editor (atau dijalankan lewat psql ke database Supabase).
//
// Selain skema, file ini juga mengisi tabel _prisma_migrations dengan checksum
// yang sama persis dengan yang dihitung Prisma, jadi setelah diimpor,
// `prisma migrate deploy` ke Supabase melihat semua migrasi sudah terpasang
// dan hanya menjalankan migrasi baru.
//
// Pemakaian:  node tools/supabase-export.mjs [file-output] [--data]
//   --data  ikut ekspor isi tabel dari Postgres lokal (perlu docker compose jalan)
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migrationsDir = join(root, 'packages/db/prisma/migrations');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const out = resolve(outArg ?? join(root, 'supabase/claudewa-schema.sql'));

const migrations = readdirSync(migrationsDir)
  .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
  .sort();

const parts = [];
const history = [];
const tables = new Set();

for (const name of migrations) {
  const raw = readFileSync(join(migrationsDir, name, 'migration.sql'));
  // Prisma menghitung checksum dari byte mentah file, termasuk CRLF.
  const checksum = createHash('sha256').update(raw).digest('hex');
  const sql = raw.toString('utf8').replace(/\r\n/g, '\n').trim();
  for (const m of sql.matchAll(/CREATE TABLE "([^"]+)"/g)) tables.add(m[1]);
  for (const m of sql.matchAll(/DROP TABLE "([^"]+)"/g)) tables.delete(m[1]);
  parts.push(`-- ============================================================\n-- Migrasi: ${name}\n-- ============================================================\n${sql}\n`);
  history.push({ name, checksum });
}

const header = `-- Skema database claudewa untuk Supabase
-- Dibuat dari ${migrations.length} migrasi Prisma oleh tools/supabase-export.mjs
-- pada ${new Date().toISOString()}.
--
-- Cara pakai: tempel seluruh isi file ini ke Supabase -> SQL Editor -> Run,
-- atau: psql "<connection string Supabase>" -f claudewa-schema.sql
-- Jalankan di database yang masih kosong (skema public belum berisi tabel ini).

BEGIN;

SET search_path TO public;
`;

const prismaTable = `-- ============================================================
-- Riwayat migrasi Prisma, supaya \`prisma migrate deploy\` tidak
-- mencoba membuat ulang tabel yang sudah ada.
-- ============================================================
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64) NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count") VALUES
${history.map((h) => `    ('${randomUUID()}', '${h.checksum}', now(), '${h.name}', 1)`).join(',\n')};
`;

// Supabase membuka skema public lewat Data API (PostgREST). Tanpa RLS, siapa pun
// yang memegang anon key bisa membaca tabel ini (hash password, token channel).
// RLS tanpa policy menutup akses itu; aplikasi tetap jalan karena Prisma
// tersambung sebagai pemilik tabel (postgres), yang tidak terkena RLS.
const rls = `-- ============================================================
-- Kunci Data API Supabase: RLS aktif tanpa policy = anon/authenticated
-- tidak bisa baca/tulis. Prisma (role postgres, pemilik tabel) tidak terpengaruh.
-- ============================================================
${[...tables, '_prisma_migrations'].map((t) => `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`).join('\n')}
`;

writeFileSync(out, [header, ...parts, prismaTable, rls, 'COMMIT;\n'].join('\n'));
console.log(`${out}\n${migrations.length} migrasi, ${tables.size} tabel`);

// ------------------------------------------------------------------
// --data: ikut buang isi tabel dari Postgres lokal (container docker
// compose) ke file terpisah, diimpor SETELAH file skema di atas.
// ------------------------------------------------------------------
if (process.argv.includes('--data')) {
  const dataOut = out.replace(/-schema\.sql$/, '') + '-data.sql';
  const dump = execFileSync(
    'docker',
    [
      'compose', 'exec', '-T', 'postgres',
      'pg_dump', '-U', 'wa', '-d', 'wa_platform',
      '--data-only', '--no-owner', '--no-privileges',
      // INSERT, bukan COPY: SQL Editor Supabase tidak mengerti COPY ... FROM stdin.
      '--column-inserts', '--rows-per-insert=200',
      // Sudah diisi oleh file skema.
      '--exclude-table=_prisma_migrations',
    ],
    { cwd: root, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString('utf8');

  const body = dump
    .replace(/\r\n/g, '\n')
    // pg_dump >= 16.10 menulis meta-command psql ini; SQL Editor menolaknya.
    .replace(/^\\(un)?restrict .*$/gm, '')
    .trim();

  // Flow.publishedVersionId -> FlowVersion dan FlowVersion.flowId -> Flow saling
  // menunjuk, jadi urutan INSERT apa pun pasti melanggar salah satunya. Role
  // postgres di Supabase bukan superuser (tidak bisa --disable-triggers), jadi
  // FK-nya dilepas sebentar lalu dipasang lagi; ADD CONSTRAINT memvalidasi ulang
  // semua baris, jadi data yang rusak tetap ketahuan.
  const fk = `"Flow_publishedVersionId_fkey"`;
  writeFileSync(
    dataOut,
    `-- Data database claudewa untuk Supabase, dari Postgres lokal pada ${new Date().toISOString()}.
-- Impor SETELAH ${out.split(/[\\/]/).pop()}.
-- BERISI DATA SENSITIF (hash password, token channel terenkripsi). Jangan di-commit.

BEGIN;

ALTER TABLE public."Flow" DROP CONSTRAINT ${fk};

${body}

ALTER TABLE public."Flow" ADD CONSTRAINT ${fk} FOREIGN KEY ("publishedVersionId") REFERENCES public."FlowVersion"(id) ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
`,
  );
  console.log(dataOut);
}
