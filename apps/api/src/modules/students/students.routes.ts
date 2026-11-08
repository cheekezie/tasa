import type { FastifyInstance } from 'fastify';
import { unprocessable } from '../../lib/errors';
import { IdParamsSchema } from '../../lib/schemas';
import { parse, send } from '../../lib/response';
import { requireActor, requireRole } from '../../plugins/auth';
import { auditAdminAction, requireActiveAdmin } from '../admins/admins.guard';
import { AVATAR_MAX_BYTES } from '../users/avatars.service';
import {
  AdminSchoolsQuerySchema,
  AdminStudentsQuerySchema,
  DepartmentsQuerySchema,
  SchoolEmailSchema,
  SchoolEmailVerifySchema,
  SchoolSchema,
  SchoolsQuerySchema,
  SchoolParamsSchema,
  StudentTermsSchema,
  FacultiesSchema,
  StudentProfileSchema,
  StudentReviewSchema,
  RevokeStudentSchema,
  UpdateSchoolSchema,
} from './students.schema';
import { revokeStudent, SchoolsService, StudentsService } from './students.service';

/**
 * `/api/students` — who a user is at school, told once and verified (school email code, or an ID
 * card Tasa staff check).
 */
export async function studentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/schools', async (req, reply) => send(reply, await SchoolsService.search(parse(SchoolsQuerySchema, req.query).search)));

  app.get('/departments', async (req, reply) => {
    const { schoolId, search } = parse(DepartmentsQuerySchema, req.query);
    return send(reply, await StudentsService.departments(schoolId, search));
  });

  app.get('/me', async (req, reply) => send(reply, await StudentsService.me(req.user.sub)));

  // "Are you a student?": the terms, then saying yes. Saving details needs it.
  app.get('/terms', async (req, reply) => send(reply, await StudentsService.terms(req.user.sub)));
  app.post('/terms', async (req, reply) => send(reply, await StudentsService.acceptTerms(req.user.sub, parse(StudentTermsSchema, req.body).acceptTerms)));

  app.get('/schools/:id/faculties', async (req, reply) => send(reply, await SchoolsService.faculties(parse(SchoolParamsSchema, req.params).id)));

  app.put('/me', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) =>
    send(reply, await StudentsService.save(req.user.sub, parse(StudentProfileSchema, req.body))),
  );

  app.post('/me/email', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) =>
    send(reply, await StudentsService.sendEmailCode(req.user.sub, parse(SchoolEmailSchema, req.body).email)),
  );

  app.post('/me/email/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email, code } = parse(SchoolEmailVerifySchema, req.body);
    return send(reply, await StudentsService.verifyEmail(req.user.sub, email, code));
  });

  /** Multipart with the file `card`: a photo of their student ID, checked by its bytes and stored encrypted. */
  app.post('/me/card', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!file) throw unprocessable('Add a photo of your student ID card', 'PHOTO_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use a photo under 5MB', 'PHOTO_TOO_LARGE');
    });
    return send(reply, await StudentsService.submitCard(req.user.sub, buffer), 201);
  });
}

/** `/api/admin/students` — checking student ID cards. Ids are the student's user id. */
export async function adminStudentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', { preHandler: requireRole('compliance', 'support') }, async (req, reply) =>
    send(reply, await StudentsService.list(parse(AdminStudentsQuerySchema, req.query))),
  );

  app.get('/:id', { preHandler: requireRole('compliance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await StudentsService.detail(id));
  });

  /** The card itself, decrypted. POST and no-store, so it stays out of URLs, history and caches. */
  app.post(
    '/:id/card',
    {
      preHandler: requireRole('compliance'),
      config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const { id } = parse(IdParamsSchema, req.params);
      const card = await StudentsService.card(id, {
        admin: req.user.sub,
        role: req.user.role,
        ip: req.ip,
      });
      return reply.header('cache-control', 'no-store').type(card.mimeType).send(card.bytes);
    },
  );

  app.post('/:id/review', { preHandler: requireRole('compliance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await StudentsService.review(id, parse(StudentReviewSchema, req.body), req.user.sub));
  });

  /** Takes a verification back. */
  app.post('/:id/revoke', { preHandler: requireRole('compliance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await revokeStudent(id, parse(RevokeStudentSchema, req.body).reason, req.user.sub));
  });
}

/** `/api/admin/schools` — the schools students can pick, and the email domains that verify them. */
export async function adminSchoolsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', { preHandler: requireRole('compliance', 'support') }, async (req, reply) =>
    send(reply, await SchoolsService.list(parse(AdminSchoolsQuerySchema, req.query))),
  );

  app.post('/', { preHandler: requireRole('compliance') }, async (req, reply) => send(reply, await SchoolsService.create(parse(SchoolSchema, req.body)), 201));

  app.patch('/:id', { preHandler: requireRole('compliance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SchoolsService.update(id, parse(UpdateSchoolSchema, req.body)));
  });

  app.get('/:id', { preHandler: requireRole('compliance', 'support') }, async (req, reply) =>
    send(reply, await SchoolsService.get(parse(IdParamsSchema, req.params).id)),
  );

  /** Its faculties and departments, and what students typed that isn't on them. */
  app.get('/:id/faculties', { preHandler: requireRole('compliance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SchoolsService.adminFaculties(id));
  });

  app.put('/:id/faculties', { preHandler: requireRole('compliance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SchoolsService.setFaculties(id, parse(FacultiesSchema, req.body).faculties));
  });

  /** Multipart with one image file: the school's logo. */
  app.post('/:id/logo', { preHandler: requireRole('compliance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!file) throw unprocessable('Choose an image to upload', 'PHOTO_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use an image under 5MB', 'PHOTO_TOO_LARGE');
    });
    return send(reply, await SchoolsService.setLogo(id, buffer));
  });
}
