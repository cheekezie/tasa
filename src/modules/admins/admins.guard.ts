import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../../lib/errors';
import { REVEAL_ROUTE } from '../users/users.service';
import { AdminAuditModel } from './models/admin-audit.model';
import { AdminModel } from './models/admin.model';
import { FEATURE_KEYS } from '../config/config.service';

/**
 * Admin tokens live 15 minutes; re-read the admin on every back-office request so a
 * deactivation or role change applies immediately, not at the next refresh.
 */
export async function requireActiveAdmin(req: FastifyRequest) {
  if (req.user.actor !== 'admin') throw unauthorized();
  const admin = await AdminModel.findById(req.user.sub).select('role isActive').lean();
  if (!admin?.isActive) throw unauthorized('Your back-office access has been removed');
  req.user.role = admin.role;
}

const AUDITED_FIELDS = ['active', 'billPointsPer100Naira', 'transferPoints', 'pointValue', 'minRedeemPoints', 'outcome', 'note', 'reason', 'fullName', 'status', 'role', 'isActive', 'amount', 'from', 'reference', 'name', 'email', 'title', 'code', 'until', 'message', ...FEATURE_KEYS];

/** `onResponse` hook for back-office routes. A failed write here must never fail the request. */
export async function auditAdminAction(req: FastifyRequest, reply: FastifyReply) {
  if (req.method === 'GET' || req.user?.actor !== 'admin') return;
  // A successful reveal is logged before the BVN is decrypted; refused attempts still land here.
  if (req.routeOptions.url === REVEAL_ROUTE && reply.statusCode === 200) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  await AdminAuditModel.create({
    admin: req.user.sub,
    role: req.user.role,
    method: req.method,
    route: req.routeOptions.url,
    // Fastify's params has no prototype, which Mongoose can't cast.
    params: { ...(req.params as Record<string, string>) },
    details: Object.fromEntries(AUDITED_FIELDS.filter((f) => f in body).map((f) => [f, body[f]])),
    statusCode: reply.statusCode,
    ip: req.ip,
  }).catch((err) => req.log.error(err, 'admin audit write failed'));
}
