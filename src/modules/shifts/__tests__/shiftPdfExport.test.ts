import express from 'express';
import supertest from 'supertest';
import zlib from 'zlib';
import authRoutes from '../../auth/auth.routes';
import shiftsRoutes from '../shifts.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

/**
 * The weekly PDF calendar used to carry the whole company's leave: every store's
 * document listed people from other stores as 0-hour rows full of "Ferie", and it
 * printed pending, cancelled and manager-rejected requests as if they were approved.
 * These cases mirror the report that surfaced it (store Como, week 2026-W38).
 */

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

// ISO week 2031-W10 runs Monday 2031-03-03 to Sunday 2031-03-09.
const WEEK = '2031-W10';

let otherStoreId: number;

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

/** Text drawn on the PDF: pdf-lib writes it as hex operands inside Flate streams. */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streams.exec(raw))) {
    let body: string;
    try {
      body = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      body = match[1];
    }
    for (const hex of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out.push(Buffer.from(hex[1], 'hex').toString('latin1'));
    }
    for (const lit of body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      out.push(lit[1]);
    }
  }
  return out.join('\n');
}

async function exportPdf(email: string, query: Record<string, string | number>) {
  const token = await login(email);
  return request
    .get('/api/shifts/export')
    .query({ format: 'pdf', week: WEEK, ...query })
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

async function addUser(email: string, name: string, surname: string, storeId: number): Promise<number> {
  const hash = await testPool
    .query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email = 'admin@acme-test.com'`)
    .then((r) => r.rows[0].password_hash);
  const { rows: [row] } = await testPool.query<{ id: number }>(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, status)
     VALUES ($1, $2, $3, $4, $5, 'employee', $6, 'active')
     ON CONFLICT (email) DO UPDATE SET store_id = EXCLUDED.store_id, status = 'active'
     RETURNING id`,
    [seeds.acmeId, name, surname, email, hash, storeId],
  );
  return row.id;
}

/**
 * `nextApprover` is who the request waits on; null means the chain is finished.
 * A finished, non-refused request needs a human approver or the integrity trigger
 * (migration 135) rejects the row, so one is recorded whenever the chain is done.
 */
async function addLeave(
  userId: number,
  storeId: number,
  from: string,
  to: string,
  status: string,
  nextApprover: string | null = null,
) {
  const finished = nextApprover === null;
  const refused = ['pending', 'rejected', 'cancelled', 'HR rejected'].includes(status);
  await testPool.query(
    `INSERT INTO leave_requests
       (company_id, user_id, store_id, leave_type, start_date, end_date, status, current_approver_role, approved_by)
     VALUES ($1, $2, $3, 'vacation', $4, $5, $6, $7, $8)`,
    [seeds.acmeId, userId, storeId, from, to, status, nextApprover, finished && !refused ? seeds.adminId : null],
  );
}

beforeAll(async () => {
  seeds = await seedTestData();
  await testPool.query('DELETE FROM login_attempts');

  const { rows: [verona] } = await testPool.query<{ id: number }>(
    `INSERT INTO stores (company_id, name, code, max_staff, is_active)
     VALUES ($1, 'Verona Test', 'VER-PDF', 10, true)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true
     RETURNING id`,
    [seeds.acmeId],
  );
  otherStoreId = verona.id;

  const romaStore = seeds.romaStoreId;

  // On the Roma roster through a shift this week.
  await testPool.query(
    `INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, status)
     VALUES ($1, $2, $3, '2031-03-04', '09:00', '17:00', 'scheduled')`,
    [seeds.acmeId, romaStore, seeds.employee1Id],
  );

  // Another store's employee on approved leave — Ivan Fascelli's case.
  const ivan = await addUser('ivan.pdf@acme-test.com', 'Ivan', 'Veronese', otherStoreId);
  await addLeave(ivan, otherStoreId, '2031-03-03', '2031-03-04', 'approved');

  // Roma's own employee on approved leave all week, no shifts — must still appear.
  const delia = await addUser('delia.pdf@acme-test.com', 'Delia', 'Romana', romaStore);
  await addLeave(delia, romaStore, '2031-03-03', '2031-03-09', 'approved');

  // Roma employees whose requests are not approved leave.
  const rosy = await addUser('rosy.pdf@acme-test.com', 'Rosy', 'Annullata', romaStore);
  await addLeave(rosy, romaStore, '2031-03-05', '2031-03-06', 'cancelled');
  const paolo = await addUser('paolo.pdf@acme-test.com', 'Paolo', 'Attesa', romaStore);
  await addLeave(paolo, romaStore, '2031-03-05', '2031-03-05', 'pending', 'store_manager');
  const gino = await addUser('gino.pdf@acme-test.com', 'Gino', 'Respinto', romaStore);
  await addLeave(gino, romaStore, '2031-03-05', '2031-03-05', 'HR rejected');

  // Chain ending at HR: 'HR approved' is terminal and must print.
  const hanna = await addUser('hanna.pdf@acme-test.com', 'Hanna', 'Approvata', romaStore);
  await addLeave(hanna, romaStore, '2031-03-07', '2031-03-07', 'HR approved');

  // Chain ending at the area manager: granted, although not a named approved spelling.
  const aldo = await addUser('aldo.pdf@acme-test.com', 'Aldo', 'Areale', romaStore);
  await addLeave(aldo, romaStore, '2031-03-06', '2031-03-06', 'area manager approved');

  // Half-way through a longer chain: still waiting on the area manager.
  const mara = await addUser('mara.pdf@acme-test.com', 'Mara', 'Intermedia', romaStore);
  await addLeave(mara, romaStore, '2031-03-06', '2031-03-06', 'store manager approved', 'area_manager');

  // Verona employee transferred into Roma this week, with approved leave on another day.
  const tito = await addUser('tito.pdf@acme-test.com', 'Tito', 'Trasferito', otherStoreId);
  await testPool.query(
    `INSERT INTO temporary_store_assignments
       (company_id, user_id, origin_store_id, target_store_id, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, '2031-03-03', '2031-03-05', 'active')`,
    [seeds.acmeId, tito, otherStoreId, romaStore],
  );
  await addLeave(tito, otherStoreId, '2031-03-08', '2031-03-08', 'approved');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('weekly shift PDF — whose leave it prints', () => {
  it("leaves out another store's staff", async () => {
    const res = await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);

    const text = extractPdfText(res.body as Buffer);
    expect(text).toContain('Anna'); // employee1, on the roster through a shift
    expect(text).not.toContain('Veronese');
  });

  it("keeps the store's own staff on approved leave, even with no shifts", async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId })).body);
    expect(text).toContain('Romana');
    expect(text).toContain('Ferie');
  });

  it('prints a terminal "HR approved" request', async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId })).body);
    expect(text).toContain('Approvata');
  });

  it('prints leave granted by a chain that ends at the area manager', async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId })).body);
    expect(text).toContain('Areale');
  });

  it('ignores a request still waiting on a later approver', async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId })).body);
    expect(text).not.toContain('Intermedia');
  });

  it('ignores cancelled, pending and manager-rejected requests', async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId })).body);
    expect(text).not.toContain('Annullata');
    expect(text).not.toContain('Attesa');
    expect(text).not.toContain('Respinto');
    expect(text).not.toContain('In attesa');
  });

  it("shows a transferred-in person's leave on this store's calendar", async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: seeds.romaStoreId })).body);
    expect(text).toContain('Trasferito');
  });

  it("prints the other store's leave on that store's own calendar", async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: otherStoreId })).body);
    expect(text).toContain('Veronese');
    expect(text).not.toContain('Romana');
  });

  it('renders a store with no shifts, no transfers and no leave', async () => {
    // The roster is empty there, which used to be an untested query path.
    const { rows: [empty] } = await testPool.query<{ id: number }>(
      `INSERT INTO stores (company_id, name, code, max_staff, is_active)
       VALUES ($1, 'Vuoto Test', 'VUO-PDF', 5, true)
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [seeds.acmeId],
    );
    const res = await exportPdf('admin@acme-test.com', { store_id: empty.id });
    expect(res.status).toBe(200);
    const text = extractPdfText(res.body as Buffer);
    expect(text).toContain('Negozio: Vuoto Test');
    expect(text).not.toContain('Romana');
    expect(text).not.toContain('Veronese');
  });

  it('names the store in the header', async () => {
    const text = extractPdfText((await exportPdf('admin@acme-test.com', { store_id: otherStoreId })).body);
    expect(text).toContain('Negozio: Verona Test');
  });
});

describe('shift export — store manager scope', () => {
  it("refuses another store's calendar", async () => {
    const res = await exportPdf('manager.roma@acme-test.com', { store_id: otherStoreId });
    expect(res.status).toBe(403);
  });

  it('narrows an unscoped export to their own store', async () => {
    const res = await exportPdf('manager.roma@acme-test.com', {});
    expect(res.status).toBe(200);
    const text = extractPdfText(res.body as Buffer);
    expect(text).toContain('Romana');
    expect(text).not.toContain('Veronese');
  });

  it('can still export their own store', async () => {
    const res = await exportPdf('manager.roma@acme-test.com', { store_id: seeds.romaStoreId });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed store id', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/shifts/export')
      .query({ week: WEEK, store_id: 'abc' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
