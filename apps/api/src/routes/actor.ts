import { ACTOR_HEADER, PERSON_HEADER, ROLE_HEADER, ROLE_LABELS, can, parseActor, type Actor, type Permission } from '@cqa/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** The demo role of the caller; undefined = unrestricted (scripts, exporter). See contracts/roles.ts: not authentication. */
export const actorOf = (req: FastifyRequest): Actor | undefined => parseActor(header(req, ROLE_HEADER), header(req, ACTOR_HEADER), header(req, PERSON_HEADER));

const WHAT: Record<Permission, string> = {
  review: 'отмечать проверку диалогов',
  decide: 'решать апелляции',
  correct: 'менять оценки',
  appeal: 'подавать апелляции',
  editChecklist: 'менять чек-лист',
  evaluate: 'запускать оценку',
  assign: 'назначать операторов',
  import: 'импортировать данные',
  manageTeams: 'менять сотрудников и группы',
  comment: 'писать комментарии',
  tag: 'отмечать причины ошибок',
  task: 'назначать задачи проверяющим',
  crosscheck: 'делать контрольную проверку',
  audit: 'смотреть журнал действий',
  timeline: 'добавлять события на шкалу',
  editTaxonomy: 'менять категории ошибок',
};

/** Answers 403 and returns true when the caller's role lacks the permission. */
export function denied(req: FastifyRequest, reply: FastifyReply, permission: Permission): boolean {
  const actor = actorOf(req);
  if (can(actor, permission)) return false;
  void reply.code(403).send({ error: `Роль «${ROLE_LABELS[actor!.role]}» не может ${WHAT[permission]}` });
  return true;
}
