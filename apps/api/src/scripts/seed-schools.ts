import { connectDB, describeDB, disconnectDB } from '../lib/db';
import { closeQueues } from '../lib/queue';
import { r2 } from '../lib/r2';
import { redis } from '../lib/redis';
import { SchoolModel, type ISchool } from '../modules/students/models/school.model';
import { StudentProfileModel } from '../modules/students/models/student.model';
import { FORMER_NAMES, SCHOOLS, type SchoolSeed } from '../modules/students/schools.data';
import { sniffImage } from '../modules/users/avatars.service';

/**
 * Lists every school in `schools.data.ts`, all switched off: staff switch on the ones students
 * can pick in the back office, and add their student email domains there (none are guessed).
 * Then copies each logo into Tasa's storage: from Wikipedia where it has one, else the school
 * website's icon. Safe to run again: schools staff have worked on (switched on, domains,
 * faculties, students) only gain what's missing, and an uploaded logo is never replaced.
 */
const UA = { 'User-Agent': 'TasaSchoolsSeed/1.0 (+https://tasa.ng)' };
/** Smaller is a favicon blown up: worse than the initial the app shows instead. */
const MIN_SIDE = 64;

/** Width and height from a PNG, JPEG or WebP header, without decoding it. */
function dimensions(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

async function download(url: string) {
  const res = await fetch(url, {
    headers: UA,
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const image = sniffImage(buffer);
  const size = dimensions(buffer);
  if (!image || !size || Math.min(size.w, size.h) < MIN_SIDE) return null;
  return { buffer, image };
}

/** Where to try for its logo, in order: Wikipedia's copy, then the icon Google keeps for its website. */
const logoSources = (s: SchoolSeed) =>
  [s.logo, s.website && `https://www.google.com/s2/favicons?domain=${new URL(s.website).hostname}&sz=256`].filter(Boolean) as string[];

async function logoFor(s: SchoolSeed) {
  for (const url of logoSources(s)) {
    const found = await download(url).catch(() => null);
    if (found) return { ...found, source: url };
  }
  return null;
}

/**
 * Nobody has worked on it yet: never switched on, no email domains or faculties, no students. The seed may correct such a school from the list, or remove it if the list dropped it.
 */
async function untouched(school: Pick<ISchool, '_id' | 'active' | 'emailDomains' | 'faculties'>) {
  if (school.active || school.emailDomains.length || school.faculties.length) return false;
  return !(await StudentProfileModel.exists({ school: school._id }));
}

async function seed() {
  await connectDB();
  console.log(`Checking ${SCHOOLS.length} schools in ${describeDB()}`);
  const byName = new Map(SCHOOLS.map((s) => [s.name, s]));
  const rowFor = (name: string) => byName.get(name) ?? byName.get(FORMER_NAMES[name] ?? '');
  let added = 0;
  let corrected = 0;
  let removed = 0;

  // Schools already listed: correct the untouched ones from the list; staff's work is left alone.
  const existing = await SchoolModel.find();
  const names = new Set(existing.map((s) => s.name));
  for (const school of existing) {
    const row = rowFor(school.name);
    const fresh = await untouched(school);
    // Listed under a former name while the current name is listed too: an untouched twin goes.
    const twin = row && row.name !== school.name && names.has(row.name);
    if (!row || twin) {
      if (!fresh) continue;
      names.delete(school.name);
      await SchoolModel.deleteOne({ _id: school._id });
      if (school.logoKey) await r2.deleteFile(school.logoKey).catch(() => undefined);
      removed += 1;
      continue;
    }
    const fields = fresh
      ? {
          name: row.name,
          shortName: row.shortName,
          kind: row.kind ?? 'university',
          ownership: row.ownership,
          state: row.state,
          ...(row.website ? { website: row.website } : {}),
        }
      : { ...(!school.ownership && { ownership: row.ownership }), ...(!school.website && row.website && { website: row.website }) };
    const changed = Object.entries(fields).some(([k, v]) => school.get(k) !== v) || (fresh && !row.website && school.website);
    if (!changed) continue;
    await SchoolModel.updateOne({ _id: school._id }, { ...fields, ...(fresh && !row.website && { $unset: { website: 1 } }) });
    if (fresh && row.name !== school.name) {
      names.delete(school.name);
      names.add(row.name);
    }
    corrected += 1;
  }

  const listed = new Set((await SchoolModel.find().select('name').lean()).map((s) => s.name));
  for (const s of SCHOOLS) {
    if (listed.has(s.name)) continue;
    await SchoolModel.create({
      name: s.name,
      shortName: s.shortName,
      kind: s.kind ?? 'university',
      ownership: s.ownership,
      state: s.state,
      website: s.website,
      emailDomains: [],
      active: false,
    });
    added += 1;
  }
  console.log(`✓ ${added} added, ${corrected} corrected, ${removed} removed (no longer on the list)`);

  // Logos: copy any missing, and redo ones the seed copied from somewhere the list no longer points to.
  // A logo staff uploaded (no logoSource) is never replaced.
  const schools = await SchoolModel.find().select('name logoKey logoSource').lean();
  const todo = schools.filter((school) => {
    const row = byName.get(school.name);
    if (!row) return false;
    if (!school.logoKey) return true;
    return school.logoSource !== undefined ? !logoSources(row).includes(school.logoSource) : false;
  });
  // Logos copied by the first seed carry no source: redo those of untouched schools, in case they were the wrong school's.
  for (const school of schools) {
    const row = byName.get(school.name);
    if (row && school.logoKey && school.logoSource === undefined && !todo.includes(school) && (await untouched((await SchoolModel.findById(school._id))!)))
      todo.push(school);
  }
  let logos = 0;
  // A few at a time: polite to the sources, and quick enough for a few hundred.
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (school) => {
        const logo = await logoFor(byName.get(school.name)!);
        if (!logo) {
          // The old one belonged to the wrong school or a source that's gone: better none than wrong.
          if (school.logoKey) {
            await SchoolModel.updateOne({ _id: school._id }, { $unset: { logoKey: 1, logoSource: 1 } });
            await r2.deleteFile(school.logoKey).catch(() => undefined);
          }
          return;
        }
        const { key } = await r2.uploadFile(logo.buffer, logo.image.extension, logo.image.mimeType, 'schools');
        await SchoolModel.updateOne({ _id: school._id }, { logoKey: key, logoSource: logo.source });
        if (school.logoKey) await r2.deleteFile(school.logoKey).catch(() => undefined);
        logos += 1;
      }),
    );
  }
  const without = await SchoolModel.countDocuments({ logoKey: { $exists: false } });
  console.log(`✓ ${logos} logos copied; ${without} schools have none yet (upload one in the back office)`);
  console.log('Switch on the schools students can pick in the back office.');
}

seed()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await disconnectDB();
    redis.disconnect();
    process.exit();
  });
